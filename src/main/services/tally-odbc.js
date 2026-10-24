/**
 * Tally Auto-Import Service
 * Connects to Tally's built-in HTTP XML server (default port 9000).
 * Tally must be open with a company loaded and HTTP server enabled.
 *
 * To enable: In Tally → F12 (Configure) → Advanced Configuration → Enable ODBC Server = Yes
 * OR: Tally → Gateway → HTTP Server (port 9000)
 */

import http from 'http'
import net from 'net'
import { spawn } from 'child_process'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'

const DEFAULT_PORT = 9000
const DEFAULT_HOST = 'localhost'
// Raised 8 Sep 2026 (0.1.17): a large branch company timed out at 45 s on a
// client PC. Tally answers only after it has finished building the whole
// export, so the wait is proportional to ledger count and vouchers; 180 s is
// the wait before the import gives up on one request (the TB fetch tries the
// ledger collection and then the Trial Balance report — worst case 2 × this).
const TIMEOUT_MS = 30000
const LONG_TIMEOUT_MS = 180000
const ODBC_TIMEOUT_MS = 12000

function xmlEscape(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function xmlUnescape(s = '') {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function tagValue(inner, tag) {
  const m = String(inner || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? xmlUnescape(m[1]).trim() : ''
}

function attrValue(tagText, attr) {
  const m = String(tagText || '').match(new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, 'i'))
  return m ? xmlUnescape(m[1]).trim() : ''
}

function parseAmount(raw) {
  const text = xmlUnescape(String(raw || '')).replace(/<[^>]+>/g, ' ').trim()
  if (!text) return 0
  const negBySuffix = /\bcr\b/i.test(text) || /\(-?[\d,]+(?:\.\d+)?\)/.test(text)
  const numText = text
    .replace(/[₹,\s]/g, '')
    .replace(/\b(dr|cr)\b/ig, '')
    .replace(/[()]/g, '')
  const n = parseFloat(numText)
  if (!Number.isFinite(n)) return 0
  if (negBySuffix) return -Math.abs(n)
  return n
}

// Only used for the Collection-XML $OpeningBalance/$ClosingBalance numbers
// (plain signed decimals, no "Dr"/"Cr" suffix text — that text-suffix case
// is handled separately by parseAmount's negBySuffix and doesn't reach
// here). Verified against live Tally data: Tally represents Debit balances
// as NEGATIVE and Credit balances as POSITIVE in these raw numbers — the
// opposite of what was assumed here before, which silently inverted every
// single ledger's sign. Do not touch the Excel dual-file / Real Books
// paths (renderer/utils/tallyParsers.js) — they parse Dr/Cr from explicit
// text suffixes in the source file and are unaffected by this convention.
function splitDrCr(raw) {
  const n = parseAmount(raw)
  return n < 0 ? { dr: Math.abs(n), cr: 0 } : { dr: 0, cr: Math.abs(n) }
}

function shortError(err) {
  return err?.message || String(err || 'Unknown error')
}

// Best-effort raw dump into %APPDATA%/fsg-bharat/tally-debug. Stock figure
// parsing has been guessed wrong from first principles more than once (see the
// sign-convention comment in getTallyStockTotals); keeping the exact bytes
// Tally sent means the next mismatch is inspected, not re-guessed. Never
// allowed to throw — a failed dump must not break an import.
function dumpDebug(name, contents, ext = 'xml') {
  try {
    const dir = join(app.getPath('userData'), 'tally-debug')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${name}-${Date.now()}.${ext}`), contents, 'utf8')
  } catch { /* best-effort debug dump */ }
}

function looksLikeLedgerCollection(body) {
  return /<LEDGER\b/i.test(body || '')
}

function looksLikeTallyReport(body) {
  return /<DSPACCNAME\b|<DSPACCINFO\b|<DSPDISPNAME\b/i.test(body || '')
}

function runPythonOdbc(mode, port = DEFAULT_PORT, keepPLLedger = false) {
  const script = String.raw`
import json
import re
import sys

mode = sys.argv[1]
port = sys.argv[2]
keep_pl_ledger = len(sys.argv) > 3 and sys.argv[3] == "1"

try:
    import pyodbc
except Exception as exc:
    print(json.dumps({"ok": False, "error": "Python pyodbc is not available: " + str(exc)}))
    sys.exit(0)

def clean(value):
    if value is None:
        return ""
    return str(value).strip()

def amount(value):
    text = clean(value)
    if text == "" or "not applicable" in text.lower():
        return 0.0
    neg = text.startswith("-") or text.endswith(" Cr") or text.endswith("Cr")
    text = re.sub(r"[^0-9.]", "", text)
    try:
        num = float(text or 0)
    except Exception:
        num = 0.0
    return -abs(num) if neg else abs(num)

def split_dr_cr(value):
    n = amount(value)
    if n < 0:
        return {"dr": 0.0, "cr": abs(n)}
    return {"dr": abs(n), "cr": 0.0}

tally_drivers = [d for d in pyodbc.drivers() if "Tally" in d]
tally_sources = {k: v for k, v in pyodbc.dataSources().items() if "Tally" in k or "Tally" in v}
if not tally_drivers and not tally_sources:
    print(json.dumps({
        "ok": False,
        "error": "Tally ODBC driver/DSN is not registered in Windows. Install/register Tally ODBC or enable Tally HTTP XML, then retry.",
        "drivers": tally_drivers,
        "sources": tally_sources,
    }))
    sys.exit(0)

conn_strings = [
    f"DSN=TallyODBC_{port};",
    f"DSN=TallyODBC64_{port};",
    f"DSN=TallyODBC32_{port};",
    f"DRIVER={{Tally ODBC Driver64}};SERVER=localhost;PORT={port};",
    f"DRIVER={{Tally ODBC Driver}};SERVER=localhost;PORT={port};",
]

last_error = ""
cn = None
for conn_str in conn_strings:
    try:
        cn = pyodbc.connect(conn_str, timeout=8)
        break
    except Exception as exc:
        last_error = str(exc)

if cn is None:
    print(json.dumps({
        "ok": False,
        "error": "Tally ODBC driver/DSN is not registered in Windows. Enable Tally ODBC and install/register the Tally ODBC driver/DSN, then retry. Last error: " + last_error,
        "drivers": tally_drivers,
        "sources": tally_sources,
    }))
    sys.exit(0)

try:
    cur = cn.cursor()
    cur.execute("SELECT $Name, $Parent, $OpeningBalance, $ClosingBalance FROM Ledger")
    ledger_rows = cur.fetchall()
    if mode == "check":
        print(json.dumps({"ok": True, "ledgerCount": len(ledger_rows)}))
        sys.exit(0)

    group_parent = {}
    try:
        gcur = cn.cursor()
        gcur.execute("SELECT $Name, $Parent FROM Group")
        for row in gcur.fetchall():
            name = clean(row[0])
            if name:
                group_parent[name] = clean(row[1]) or None
    except Exception:
        pass

    def chain_of(group_name):
        chain = []
        cur_name = clean(group_name)
        seen = set()
        while cur_name and cur_name not in seen and len(chain) < 32:
            seen.add(cur_name)
            chain.append(cur_name)
            cur_name = group_parent.get(cur_name) or ""
        return chain

    tb_rows = []
    ledger_map = {}
    pl_ledger_re = re.compile(r"^profit\s*(&|and)\s*loss\s*a/?c\.?$", re.IGNORECASE)
    for row in ledger_rows:
        name = clean(row[0])
        if not name or (not keep_pl_ledger and pl_ledger_re.match(name)):
            continue
        parent = clean(row[1])
        opening = split_dr_cr(row[2])
        closing = split_dr_cr(row[3])
        tb_rows.append({
            "name": name,
            "opening_dr": opening["dr"],
            "opening_cr": opening["cr"],
            "debit": 0,
            "credit": 0,
            "closing_dr": closing["dr"],
            "closing_cr": closing["cr"],
            "opening_net": opening["dr"] - opening["cr"],
            "closing_net": closing["dr"] - closing["cr"],
        })
        hierarchy = chain_of(parent)
        ledger_map[name.strip().lower()] = {
            "name": name,
            "parent": parent,
            "hierarchy": hierarchy,
            "affectsstock": False,
        }

    print(json.dumps({
        "ok": True,
        "tbRows": tb_rows,
        "masterData": {
            "ledgerMap": ledger_map,
            "groupCount": len(group_parent),
            "ledgerCount": len(ledger_map),
        },
    }))
except Exception as exc:
    print(json.dumps({"ok": False, "error": "Tally ODBC query failed: " + str(exc)}))
finally:
    try:
        cn.close()
    except Exception:
        pass
`

  return new Promise((resolve, reject) => {
    const child = spawn('python', ['-c', script, mode, String(parseInt(port) || DEFAULT_PORT), keepPLLedger ? '1' : '0'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Tally ODBC ${mode} timed out after ${Math.round(ODBC_TIMEOUT_MS / 1000)} s.`))
    }, ODBC_TIMEOUT_MS)

    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', err => {
      clearTimeout(timer)
      const permissionHint = err.code === 'EPERM'
        ? ' Permission was denied while starting Python; run the installed app normally, or use HTTP XML mode.'
        : ''
      reject(new Error('Could not start Python ODBC check: ' + err.message + permissionHint))
    })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const text = stdout.trim()
        const parsed = JSON.parse(text || '{}')
        if (!parsed.ok) reject(new Error(parsed.error || stderr || 'Tally ODBC failed.'))
        else resolve(parsed)
      } catch (err) {
        reject(new Error('Tally ODBC returned unreadable output: ' + (stdout || stderr || err.message)))
      }
    })
  })
}

export async function checkTallyOdbc(host, port) {
  if (host && !/^(localhost|127\.0\.0\.1|::1)$/i.test(String(host))) {
    throw new Error('ODBC fallback can only run on the computer where Tally is installed. Use localhost.')
  }
  return runPythonOdbc('check', port)
}

export async function getTallyDataViaOdbc(host, port, keepPLLedger = false) {
  if (host && !/^(localhost|127\.0\.0\.1|::1)$/i.test(String(host))) {
    throw new Error('ODBC fallback can only run on the computer where Tally is installed. Use localhost.')
  }
  return runPythonOdbc('fetch', port, keepPLLedger)
}

// ── Raw TCP check — tells us if the port is open at all ──────────────────────
export function tcpPing(host, port) {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    const h = host || DEFAULT_HOST
    const p = parseInt(port) || DEFAULT_PORT
    sock.setTimeout(3000)
    sock.connect(p, h, () => { sock.destroy(); resolve({ open: true }) })
    sock.on('error', (e) => { sock.destroy(); resolve({ open: false, code: e.code }) })
    sock.on('timeout', () => { sock.destroy(); resolve({ open: false, code: 'TIMEOUT' }) })
  })
}

function tallyRequest(xmlBody, host = DEFAULT_HOST, port = DEFAULT_PORT, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const bodyBuffer = Buffer.from(xmlBody, 'utf8')
    const options = {
      hostname: host || DEFAULT_HOST,
      port:     parseInt(port) || DEFAULT_PORT,
      path:     '/',
      method:   'POST',
      headers: {
        'Content-Type':   'text/xml',
        'Content-Length': bodyBuffer.length,
      },
      timeout: timeoutMs,
    }

    const req = http.request(options, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve({ ok: true, status: res.statusCode, body: data }))
      res.on('error', err => reject(new Error('Response error: ' + err.message)))
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`TIMEOUT - Tally connected but did not respond within ${Math.round(timeoutMs / 1000)} s. Ensure a company is open in Tally and no Tally dialog/report is blocking export.`))
    })

    req.on('error', (err) => {
      const map = {
        ECONNREFUSED: 'ECONNREFUSED — Port ' + (parseInt(port) || DEFAULT_PORT) + ' is not listening. Tally HTTP server may not be active yet.',
        ECONNRESET:   'ECONNRESET — Tally closed the connection. Try again after a moment.',
        ENOTFOUND:    'ENOTFOUND — Hostname "' + (host || DEFAULT_HOST) + '" not found on the network.',
        ETIMEDOUT:    'ETIMEDOUT — Could not reach ' + (host || DEFAULT_HOST) + ':' + (parseInt(port) || DEFAULT_PORT) + '. Check firewall / network.',
      }
      reject(new Error(map[err.code] || ('ERR ' + err.code + ': ' + err.message)))
    })

    req.write(bodyBuffer)
    req.end()
  })
}

// ── TallyPrime-compatible: get current company via Balance Sheet export ────────
// "List of Companies" is ERP 9 only. In TallyPrime we export Balance Sheet and
// read SVCURRENTCOMPANY / BASICCOMPANYNAME from the response header.
async function fetchCurrentCompany(host, port) {
  // Query whichever company is currently open in Tally — no date range
  // needed, and nothing to match by name. TallyPrime only ever has one
  // company active at a time, so this is unambiguous and fast.
  const companyXml = `<ENVELOPE>
    <HEADER>
      <VERSION>1</VERSION>
      <TALLYREQUEST>Export</TALLYREQUEST>
      <TYPE>Collection</TYPE>
      <ID>VERA Companies</ID>
    </HEADER>
    <BODY><DESC><TDL><TDLMESSAGE>
      <COLLECTION NAME="VERA Companies" ISMODIFY="No">
        <TYPE>Company</TYPE>
        <FETCH>Name</FETCH>
      </COLLECTION>
    </TDLMESSAGE></TDL></DESC></BODY>
  </ENVELOPE>`
  const { body } = await tallyRequest(companyXml, host, port, LONG_TIMEOUT_MS)
  const m = body.match(/<COMPANY\b([^>]*)>([\s\S]*?)<\/COMPANY>/i)
  const name = m ? (attrValue(m[1], 'NAME') || tagValue(m[2], 'NAME')) : ''
  if (name) return { name, raw: body }

  // Fallback: older ERP 9 style header tags, in case the collection above
  // returned nothing but Tally is still responsive.
  const patterns = [
    /<SVCURRENTCOMPANY[^>]*>(.*?)<\/SVCURRENTCOMPANY>/i,
    /<BASICCOMPANYNAME[^>]*>(.*?)<\/BASICCOMPANYNAME>/i,
    /<COMPANYNAME[^>]*>(.*?)<\/COMPANYNAME>/i,
    /<CMPSNAME[^>]*>(.*?)<\/CMPSNAME>/i,
  ]
  for (const re of patterns) {
    const pm = body.match(re)
    if (pm?.[1]?.trim()) return { name: pm[1].trim(), raw: body }
  }

  // Fallback: if the response has ENVELOPE content, Tally is working,
  // we just couldn't parse the name automatically. Not fatal — the
  // Trial Balance / Ledger export below doesn't need a company name at all.
  if (body.includes('ENVELOPE') || body.includes('<ENVELOPE>')) {
    return { name: null, raw: body }
  }
  throw new Error('Could not read company name from TallyPrime. Raw: ' + body.substring(0, 200))
}

// ── Check if Tally is running — returns rich diagnostics ─────────────────────
export async function checkTallyRunning(host, port) {
  const h = host || DEFAULT_HOST
  const p = parseInt(port) || DEFAULT_PORT

  // Step 1: TCP ping — check if port is open at all
  const ping = await tcpPing(h, p)
  if (!ping.open) {
    return {
      running: false,
      step: 'tcp',
      errorCode: ping.code,
      error: ping.code === 'TIMEOUT'
        ? `Port ${p} on ${h} is not reachable (TCP timeout). Tally may not be running, or Windows Firewall is blocking port ${p}.`
        : `Port ${p} on ${h} is closed (${ping.code}). Tally HTTP server is not active. In TallyPrime: F12 → Advanced Configuration → Enable ODBC Server = Yes, Port = ${p}. Then restart Tally and ensure a company is open.`,
    }
  }

  // Step 2: TallyPrime-compatible XML check using Balance Sheet
  try {
    const { name, raw } = await fetchCurrentCompany(h, p)
    return {
      running: true,
      step: 'xml',
      detectedCompany: name,
      rawPreview: raw.substring(0, 200),
    }
  } catch (err) {
    try {
      const odbc = await checkTallyOdbc(h, p)
      return {
        running: true,
        step: 'odbc',
        detectedCompany: null,
        message: `Connected through Tally ODBC. Found ${odbc.ledgerCount || 0} ledgers.`,
        xmlError: err.message,
      }
    } catch (odbcErr) {
      return {
        running: false,
        step: 'xml-odbc',
        error: `${err.message} ODBC fallback also failed: ${odbcErr.message}`,
      }
    }
    return {
      running: false,
      step: 'xml',
      error: err.message,
    }
  }
}

// ── Get list of open companies in Tally ───────────────────────────────────────
// TallyPrime only has ONE active company at a time; we detect it from the XML.
export async function getTallyCompanies(host, port) {
  const h = host || DEFAULT_HOST
  const p = parseInt(port) || DEFAULT_PORT
  const { name } = await fetchCurrentCompany(h, p)
  return name ? [name] : []
}

// ── EVERY company currently loaded in Tally, not just the first ─────────────
// The multi-branch bug turned on this distinction. Tally happily holds several
// companies open at once; the Company collection returns all of them, and
// fetchCurrentCompany() above deliberately takes only the FIRST match because
// it is answering "is Tally alive and what is it showing".
//
// That is the wrong question at import time. With Branch 1 and Branch 2 both
// loaded, "the first company Tally lists" is not necessarily the one being
// imported — so scoping every request to it either pins the wrong company or,
// when the name fails to parse, falls back to no scoping at all and the stock
// figures drift to whichever company Tally resolves them against.
//
// Verified against live Tally: SVCURRENTCOMPANY IS honoured (scoping a
// StockItem collection to a non-existent company returns nothing, while the
// real name returns all 55 items). The mechanism works — it just has to be
// given the right name, which only the user reliably knows.
export async function listTallyCompanies(host, port) {
  const h = host || DEFAULT_HOST
  const p = parseInt(port) || DEFAULT_PORT
  const xml = `<ENVELOPE>
    <HEADER>
      <VERSION>1</VERSION>
      <TALLYREQUEST>Export</TALLYREQUEST>
      <TYPE>Collection</TYPE>
      <ID>VERA All Companies</ID>
    </HEADER>
    <BODY><DESC><TDL><TDLMESSAGE>
      <COLLECTION NAME="VERA All Companies" ISMODIFY="No">
        <TYPE>Company</TYPE>
        <FETCH>Name</FETCH>
      </COLLECTION>
    </TDLMESSAGE></TDL></DESC></BODY>
  </ENVELOPE>`
  try {
    const { body } = await tallyRequest(xml, h, p, LONG_TIMEOUT_MS)
    dumpDebug('companies-raw', body)
    const names = []
    const re = /<COMPANY([^>]*)>([\s\S]*?)<\/COMPANY>/gi
    let m
    while ((m = re.exec(body)) !== null) {
      const n = (attrValue(m[1], 'NAME') || tagValue(m[2], 'NAME') || '').trim()
      if (n && !names.includes(n)) names.push(n)
    }
    return names
  } catch (err) {
    return []
  }
}

// ── Get Trial Balance from Tally (TallyPrime-compatible) ─────────────────────
// No company name or date range is sent — TallyPrime only ever has one
// company open at a time, and omitting SVFROMDATE/SVTODATE makes Tally use
// whatever period is currently active in its own UI (Alt+F2 / current
// period), which avoids stalls when a guessed date range doesn't match the
// company's books and Tally silently blocks on an internal prompt.
export async function getTallyTrialBalance(host, port, company = null) {
  const failures = []
  const collectionXml = `<ENVELOPE>
    <HEADER>
      <VERSION>1</VERSION>
      <TALLYREQUEST>Export</TALLYREQUEST>
      <TYPE>Collection</TYPE>
      <ID>VERA Ledger TB</ID>
    </HEADER>
    <BODY><DESC>
      <STATICVARIABLES>
        ${staticVars(company)}
      </STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="VERA Ledger TB" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <FETCH>Name,Parent,OpeningBalance,DebitTotals,CreditTotals,ClosingBalance</FETCH>
        </COLLECTION>
      </TDLMESSAGE></TDL>
    </DESC></BODY>
  </ENVELOPE>`

  try {
    const first = await tallyRequest(collectionXml, host, port, LONG_TIMEOUT_MS)
    if (looksLikeLedgerCollection(first.body)) return first.body
    failures.push(`ledger collection returned no LEDGER rows (${first.body.substring(0, 180)})`)
  } catch (err) {
    failures.push(`ledger collection failed: ${shortError(err)}`)
  }

  const xml = `<ENVELOPE>
    <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
    <BODY><EXPORTDATA><REQUESTDESC>
      <REPORTNAME>Trial Balance</REPORTNAME>
      <STATICVARIABLES>
        ${staticVars(company)}
      </STATICVARIABLES>
    </REQUESTDESC></EXPORTDATA></BODY>
  </ENVELOPE>`
  try {
    const { body } = await tallyRequest(xml, host, port, LONG_TIMEOUT_MS)
    if (looksLikeLedgerCollection(body) || looksLikeTallyReport(body)) return body
    failures.push(`trial balance report returned unexpected XML (${body.substring(0, 180)})`)
  } catch (err) {
    failures.push(`trial balance report failed: ${shortError(err)}`)
  }

  throw new Error(
    'Tally is connected, but Trial Balance export could not be completed. ' +
    failures.join(' | ') +
    ' Please keep the required company open in Tally, close any open report/dialog, and retry. If this repeats, export TB from Tally once and use the file upload option.'
  )
}

// ── Company scoping ──────────────────────────────────────────────────────────
// CA note: Tally can have SEVERAL companies loaded at once. A Collection or
// report request that does NOT name a company resolves against whatever Tally
// considers "current" — and, critically, different request types do not always
// resolve to the SAME one. That is how a branch import ends up with the ledgers
// of Branch 2 but the stock figures of Branch 1: the Ledger collection followed
// the selected company while the StockItem collection answered from another.
//
// Every request therefore states the company explicitly. The name is resolved
// ONCE per import (see tally:fetchTB) and threaded through every call, so the
// Trial Balance, the masters and all three stock sources are guaranteed to come
// from one and the same company.
function staticVars(company) {
  const scope = company
    ? `
        <SVCURRENTCOMPANY>${xmlEscape(company)}</SVCURRENTCOMPANY>`
    : ''
  return `<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${scope}`
}

// ── Get aggregate Opening/Closing Stock value from Tally's Stock Items ───────
// CA note: Tally tracks inventory via Stock Items, not ledger accounts — it
// almost never has an actual "Opening Stock"/"Closing Stock" LEDGER with a
// balance (Opening Stock only shows up as a ledger when someone's booked it
// manually; Closing Stock essentially never does, since Tally computes P&L
// closing stock internally from Stock Items instead of a ledger entry). This
// sums $OpeningValue/$ClosingValue across every Stock Item to get the TOTAL
// inventory value Tally itself would show for that date — the closest thing
// to "the Opening/Closing Stock figure" available from Tally without asking
// the user to bifurcate it by category first. Best-effort: a company with no
// inventory feature enabled simply returns zeros, this must never fail the
// TB import.
export async function getTallyStockTotals(host, port, company = null) {
  const xml = `<ENVELOPE>
    <HEADER>
      <VERSION>1</VERSION>
      <TALLYREQUEST>Export</TALLYREQUEST>
      <TYPE>Collection</TYPE>
      <ID>VERA Stock Items</ID>
    </HEADER>
    <BODY><DESC>
      <STATICVARIABLES>
        ${staticVars(company)}
      </STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="VERA Stock Items" ISMODIFY="No">
          <TYPE>StockItem</TYPE>
          <FETCH>Name,OpeningValue,ClosingValue</FETCH>
        </COLLECTION>
      </TDLMESSAGE></TDL>
    </DESC></BODY>
  </ENVELOPE>`

  try {
    const { body } = await tallyRequest(xml, host, port, LONG_TIMEOUT_MS)

    // Debug dump — the per-item sign convention here has been guessed wrong
    // twice already (see comments below). Always save the raw response PLUS
    // a per-item breakdown so a reported mismatch can be inspected against
    // real Tally data instead of guessed at again.
    let debugLines = []
    try {
      const dir = join(app.getPath('userData'), 'tally-debug')
      mkdirSync(dir, { recursive: true })
      const stamp = Date.now()
      writeFileSync(join(dir, `stock-items-raw-${stamp}.xml`), body, 'utf8')
    } catch { /* best-effort debug dump */ }

    let openingStockTotal = 0
    let closingStockTotal = 0
    let itemCount = 0
    const itemRegex = /<STOCKITEM\b([^>]*)>([\s\S]*?)<\/STOCKITEM>/gi
    let m
    while ((m = itemRegex.exec(body)) !== null) {
      const inner = m[2]
      // Sum the signed value as Tally reports it, per item — a genuinely
      // negative (over-issued/abnormal) item must SUBTRACT from the total,
      // not add to it (forcing abs() per-item double-counted such an item,
      // confirmed against a real mismatch: Ganesh Plastic Centre's total was
      // exactly 2× one item's value too high). abs()-ing per item was wrong;
      // but so is trusting the raw per-item sign unconditionally — some
      // Tally configurations report EVERY item consistently negative (a
      // Dr-side convention applied to stock values too), which would send
      // the whole total negative for entities with no abnormal items at all.
      // Take the absolute value of the FINAL total instead: correct for a
      // wholesale sign flip (all-negative case) while still letting one
      // truly abnormal item subtract from an otherwise-positive total
      // (Ganesh Plastic Centre case) rather than inflating it.
      const itemName = (attrValue(m[1], 'NAME') || tagValue(inner, 'NAME') || '').trim()
      const rawOpening = tagValue(inner, 'OPENINGVALUE')
      const rawClosing = tagValue(inner, 'CLOSINGVALUE')
      const parsedOpening = parseAmount(rawOpening)
      const parsedClosing = parseAmount(rawClosing)
      debugLines.push(`${itemName} | raw_opening="${rawOpening}" parsed_opening=${parsedOpening} | raw_closing="${rawClosing}" parsed_closing=${parsedClosing}`)
      openingStockTotal += parsedOpening
      closingStockTotal += parsedClosing
      itemCount++
    }
    try {
      const dir = join(app.getPath('userData'), 'tally-debug')
      const stamp = Date.now()
      writeFileSync(
        join(dir, `stock-items-breakdown-${stamp}.txt`),
        `Sum before abs(): opening=${openingStockTotal} closing=${closingStockTotal}\nAfter abs(): opening=${Math.abs(openingStockTotal)} closing=${Math.abs(closingStockTotal)}\n\n${debugLines.join('\n')}`,
        'utf8'
      )
    } catch { /* best-effort debug dump */ }
    return { openingStockTotal: Math.abs(openingStockTotal), closingStockTotal: Math.abs(closingStockTotal), itemCount }
  } catch (err) {
    // Inventory may not be enabled for this company, or the request timed
    // out — this is a nice-to-have, never let it break the TB import.
    return { openingStockTotal: 0, closingStockTotal: 0, itemCount: 0, error: shortError(err) }
  }
}

// ── Stock-in-Hand LEDGER balances ────────────────────────────────────────────
// CA note: getTallyStockTotals above reads the *Inventory Register* — item-level
// valuation. That is only what Tally's P&L actually uses when F11 > "Integrate
// Accounts and Inventory" is YES.
//
// When that feature is set to NO, Tally IGNORES item-level valuation for the
// P&L entirely and uses whatever the client has typed into the Stock-in-Hand
// ledger(s) instead. Those are ordinary ledgers with real balances, so this
// reads them directly. A non-zero closing balance here is the signal that
// manual stock values are in use — which is precisely how we "see whether
// manual values have been given in Tally" without asking the user.
//
// Opening balance = last year's manually-entered closing stock; closing
// balance = this year's. Both are Dr-natured (an asset), so parseAmount's
// sign is normalised with abs() at the total level — same reasoning as
// getTallyStockTotals: a wholesale Dr-side sign convention must not flip the
// total negative.
export async function getTallyStockLedgers(host, port, company = null) {
  const xml = `<ENVELOPE>
    <HEADER>
      <VERSION>1</VERSION>
      <TALLYREQUEST>Export</TALLYREQUEST>
      <TYPE>Collection</TYPE>
      <ID>VERA Stock Ledgers</ID>
    </HEADER>
    <BODY><DESC>
      <STATICVARIABLES>
        ${staticVars(company)}
      </STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="VERA Stock Ledgers" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <FETCH>Name,Parent,OpeningBalance,ClosingBalance</FETCH>
        </COLLECTION>
      </TDLMESSAGE></TDL>
    </DESC></BODY>
  </ENVELOPE>`

  try {
    const { body } = await tallyRequest(xml, host, port, LONG_TIMEOUT_MS)
    dumpDebug('stock-ledgers-raw', body)

    let opening = 0
    let closing = 0
    const matched = []
    const ledgerRegex = /<LEDGER\b([^>]*)>([\s\S]*?)<\/LEDGER>/gi
    let m
    while ((m = ledgerRegex.exec(body)) !== null) {
      const inner = m[2]
      const name = (attrValue(m[1], 'NAME') || tagValue(inner, 'NAME') || '').trim()
      const parent = (tagValue(inner, 'PARENT') || '').trim()
      // Tally's reserved group is literally "Stock-in-Hand" — parentage is the
      // reliable signal and is checked first.
      //
      // The name-based fallback exists only for clients who have renamed that
      // group, and is deliberately narrow: it requires a full stock phrase AND
      // a Current-Assets-ish (or absent) parent. A bare /^stock\b/ was too
      // greedy — it swallowed P&L ledgers like "Stock Adjustment" and any
      // "Closing Stock" ledger sitting under a P&L group, inflating the very
      // total this function exists to report accurately.
      const isStockGroup = /stock[\s-]*in[\s-]*hand/i.test(parent)
      const nameLooksStock = /^(closing|opening)\s+stock\b|^stock[\s-]*in[\s-]*hand\b|^inventor(y|ies)\b/i.test(name)
      const parentPlausible = !parent || /current\s*asset/i.test(parent)
      if (!isStockGroup && !(nameLooksStock && parentPlausible)) continue

      const op = parseAmount(tagValue(inner, 'OPENINGBALANCE'))
      const cl = parseAmount(tagValue(inner, 'CLOSINGBALANCE'))
      opening += op
      closing += cl
      matched.push(`${name} | parent="${parent}" opening=${op} closing=${cl}`)
    }

    dumpDebug('stock-ledgers-breakdown', `opening=${opening} closing=${closing}\n\n${matched.join('\n')}`, 'txt')
    return {
      openingStockTotal: Math.abs(opening),
      closingStockTotal: Math.abs(closing),
      ledgerCount: matched.length,
    }
  } catch (err) {
    return { openingStockTotal: 0, closingStockTotal: 0, ledgerCount: 0, error: shortError(err) }
  }
}

// ── Opening / Closing Stock as Tally's own P&L reports them ──────────────────
// The most authoritative source there is: whatever Tally itself prints on the
// Profit & Loss A/c is what the client's P&L must match, regardless of which
// internal mechanism produced it (item valuation or a manual Stock-in-Hand
// figure). Tally resolves that question internally; reading the P&L means we
// never have to.
//
// Tally's P&L report export emits alternating <DSPACCNAME> (the caption) and
// <DSPACCINFO> (the amounts) blocks. Amount tag names vary across Tally
// builds and report variants, so every known numeric tag is tried in turn
// rather than assuming one shape. The raw XML is always dumped so a
// mismatch can be inspected against real data instead of guessed at — the
// per-item sign convention in getTallyStockTotals was guessed wrong twice
// before that dump existed.
export async function getTallyPLStock(host, port, company = null) {
  const xml = `<ENVELOPE>
    <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
    <BODY><EXPORTDATA><REQUESTDESC>
      <REPORTNAME>Profit and Loss</REPORTNAME>
      <STATICVARIABLES>
        ${staticVars(company)}
      </STATICVARIABLES>
    </REQUESTDESC></EXPORTDATA></BODY>
  </ENVELOPE>`

  try {
    const { body } = await tallyRequest(xml, host, port, LONG_TIMEOUT_MS)
    dumpDebug('pl-report-raw', body)

    // Pair each caption with the amount block that follows it. Splitting on
    // DSPACCNAME keeps caption and amounts together even when the report
    // nests extra elements between them.
    const AMOUNT_TAGS = [
      'DSPCLDRAMT', 'DSPCLCRAMT', 'DSPCLAMTA', 'DSPCLAMT',
      'DSPOPDRAMT', 'DSPOPCRAMT', 'DSPOPAMT', 'AMOUNT',
    ]
    const firstAmount = (chunk) => {
      for (const tag of AMOUNT_TAGS) {
        const raw = tagValue(chunk, tag)
        if (raw !== '') {
          const n = parseAmount(raw)
          if (Number.isFinite(n) && n !== 0) return n
        }
      }
      return null
    }

    let plOpening = null
    let plClosing = null
    const seen = []
    const parts = body.split(/<DSPACCNAME\b/i).slice(1)
    for (const part of parts) {
      const caption = tagValue(part, 'DSPDISPNAME').trim()
      if (!caption) continue
      const amt = firstAmount(part)
      seen.push(`${caption} => ${amt}`)
      if (amt === null) continue
      if (plOpening === null && /^opening\s*stock\b/i.test(caption)) plOpening = Math.abs(amt)
      else if (plClosing === null && /^closing\s*stock\b/i.test(caption)) plClosing = Math.abs(amt)
    }

    dumpDebug(
      'pl-report-captions',
      `plOpening=${plOpening} plClosing=${plClosing}\n\n${seen.join('\n')}`,
      'txt'
    )
    return { plOpening, plClosing, captionCount: seen.length }
  } catch (err) {
    return { plOpening: null, plClosing: null, captionCount: 0, error: shortError(err) }
  }
}

// ── Decide which Opening/Closing Stock figure the import should use ──────────
// Priority, highest first:
//   1. Tally's own P&L      — what the client's printed P&L shows, by definition.
//   2. Stock-in-Hand ledger — manual stock values, used when F11 "Integrate
//                             Accounts and Inventory" is No.
//   3. Inventory Register   — item-level valuation (the old, only, behaviour).
//
// `ambiguous` is set when two sources that both produced a figure disagree by
// more than a rounding tolerance. The caller surfaces that to the CA and lets
// them pick, rather than silently choosing and quietly breaking the P&L.
const MATERIAL_ABS = 1        // ignore sub-rupee rounding
const MATERIAL_REL = 0.005    // and differences under 0.5%

function materiallyDifferent(a, b) {
  if (!(a > 0) || !(b > 0)) return false
  const diff = Math.abs(a - b)
  return diff > MATERIAL_ABS && diff / Math.max(a, b) > MATERIAL_REL
}

export async function resolveStockFigures(host, port, company = null) {
  // All three are best-effort and independent — run them together so a slow
  // or unavailable source costs no extra wall-clock time on import.
  const [inventory, stockInHand, pl] = await Promise.all([
    getTallyStockTotals(host, port, company),
    getTallyStockLedgers(host, port, company),
    getTallyPLStock(host, port, company),
  ])

  const candidates = []
  if (pl.plOpening > 0 || pl.plClosing > 0) {
    candidates.push({
      source: 'pl',
      label: "Tally's Profit & Loss A/c",
      opening: pl.plOpening || 0,
      closing: pl.plClosing || 0,
    })
  }
  if (stockInHand.closingStockTotal > 0 || stockInHand.openingStockTotal > 0) {
    candidates.push({
      source: 'stock-in-hand',
      label: 'Stock-in-Hand ledger (manually entered in Tally)',
      opening: stockInHand.openingStockTotal,
      closing: stockInHand.closingStockTotal,
    })
  }
  if (inventory.closingStockTotal > 0 || inventory.openingStockTotal > 0) {
    candidates.push({
      source: 'inventory',
      label: 'Inventory Register (item-level valuation)',
      opening: inventory.openingStockTotal,
      closing: inventory.closingStockTotal,
    })
  }

  const chosen = candidates[0] || { source: 'none', label: 'No stock figure found', opening: 0, closing: 0 }

  // Manual stock is in play when a Stock-in-Hand ledger carries a real
  // balance — that only happens when the client has typed one in.
  const manualStockDetected = stockInHand.closingStockTotal > 0 || stockInHand.openingStockTotal > 0

  const ambiguous = candidates.length > 1 && candidates.slice(1).some(c =>
    materiallyDifferent(c.opening, chosen.opening) ||
    materiallyDifferent(c.closing, chosen.closing)
  )

  return {
    // Back-compat: UploadTB.jsx and tb:uploadTally already read these names.
    openingStockTotal: chosen.opening,
    closingStockTotal: chosen.closing,
    itemCount: inventory.itemCount || 0,
    // New, for the source chooser.
    chosenSource: chosen.source,
    chosenLabel: chosen.label,
    manualStockDetected,
    ambiguous,
    candidates,
    raw: { inventory, stockInHand, pl },
  }
}

// ── Get Ledger Masters from TallyPrime ────────────────────────────────────────
// TallyPrime: export LEDGER and GROUP objects via collection. No company
// name is sent — same reasoning as getTallyTrialBalance above.
export async function getTallyLedgerMasters(host, port, company = null) {
  const failures = []
  const xml = `<ENVELOPE>
    <HEADER>
      <VERSION>1</VERSION>
      <TALLYREQUEST>Export</TALLYREQUEST>
      <TYPE>Collection</TYPE>
      <ID>VERA Ledgers</ID>
    </HEADER>
    <BODY><DESC>
      <STATICVARIABLES>
        ${staticVars(company)}
      </STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="VERA Ledgers" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <FETCH>Name,Parent,IsRevenue,IsDeemedPositive,AffectsStock</FETCH>
        </COLLECTION>
      </TDLMESSAGE></TDL>
    </DESC></BODY>
  </ENVELOPE>`
  let ledgerBody = ''
  try {
    const res = await tallyRequest(xml, host, port, LONG_TIMEOUT_MS)
    ledgerBody = res.body
    if (!looksLikeLedgerCollection(ledgerBody)) {
      failures.push(`ledger master collection returned no LEDGER rows (${ledgerBody.substring(0, 180)})`)
    }
  } catch (err) {
    failures.push(`ledger master collection failed: ${shortError(err)}`)
  }

  const grpXml = `<ENVELOPE>
    <HEADER>
      <VERSION>1</VERSION>
      <TALLYREQUEST>Export</TALLYREQUEST>
      <TYPE>Collection</TYPE>
      <ID>VERA Groups</ID>
    </HEADER>
    <BODY><DESC>
      <STATICVARIABLES>
        ${staticVars(company)}
      </STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="VERA Groups" ISMODIFY="No">
          <TYPE>Group</TYPE>
          <FETCH>Name,Parent,IsDeemedPositive</FETCH>
        </COLLECTION>
      </TDLMESSAGE></TDL>
    </DESC></BODY>
  </ENVELOPE>`
  let groupBody = ''
  try {
    const res = await tallyRequest(grpXml, host, port, LONG_TIMEOUT_MS)
    groupBody = res.body
    if (!/<GROUP\b/i.test(groupBody)) {
      failures.push(`group master collection returned no GROUP rows (${groupBody.substring(0, 180)})`)
    }
  } catch (err) {
    failures.push(`group master collection failed: ${shortError(err)}`)
  }

  if (!looksLikeLedgerCollection(ledgerBody)) {
    throw new Error(
      'Tally is connected, but Chart of Accounts export could not be completed. ' +
      failures.join(' | ') +
      ' Please close any open Tally dialog/report and retry.'
    )
  }

  // Combine both into one XML string for the existing parser
  return ledgerBody + groupBody
}

// Tally's reserved "Profit & Loss A/c" ledger (under Capital Account) holds
// the accumulated/current-period P&L balance that Tally computes internally
// from all Income/Expense ledgers. This app derives P&L the same way from
// those same ledgers (via ALIE > Income/Expenses), so including this ledger
// as its own TB line double-counts the period's profit or loss. Excluded
// only from the live Tally ODBC/HTTP-XML import — the Excel dual-file and
// Real Books upload paths are untouched, per instruction.
const isProfitAndLossLedger = (name) => /^profit\s*(&|and)\s*loss\s*a\/?c\.?$/i.test((name || '').trim())

// ── Parse Tally TB XML into rows compatible with our system ───────────────────
// keepPLLedger: set when the client has ALREADY closed this year's P&L into
// Capital via a real Tally journal entry (see schema.js's pl_closed_to_capital
// column doc comment) — in that case the "Profit & Loss A/c" ledger's
// remaining balance (if any) is genuine and must flow through normally,
// rather than being dropped as if it were just Tally's live auto-display.
export function parseTallyTBXml(xmlString, keepPLLedger = false) {
  const rows = []

  // Collection export shape: <LEDGER NAME="..."><OPENINGBALANCE>...</...>
  const ledgerRegex = /<LEDGER\b([^>]*)>([\s\S]*?)<\/LEDGER>/gi
  let match
  while ((match = ledgerRegex.exec(xmlString)) !== null) {
    const name = (attrValue(match[1], 'NAME') || tagValue(match[2], 'NAME')).trim()
    if (!keepPLLedger && isProfitAndLossLedger(name)) continue
    const inner = match[2]

    const opening = splitDrCr(tagValue(inner, 'OPENINGBALANCE') || tagValue(inner, 'OPENINGBAL'))
    const closing = splitDrCr(tagValue(inner, 'CLOSINGBALANCE') || tagValue(inner, 'CLOSINGBAL'))
    const debit = Math.abs(parseAmount(tagValue(inner, 'DEBITTOTALS') || tagValue(inner, 'DEBITAMOUNT') || tagValue(inner, 'DRAMS')))
    const credit = Math.abs(parseAmount(tagValue(inner, 'CREDITTOTALS') || tagValue(inner, 'CREDITAMOUNT') || tagValue(inner, 'CRAMS')))

    if (name) {
      rows.push({
        name,
        opening_dr: opening.dr,
        opening_cr: opening.cr,
        debit,
        credit,
        closing_dr: closing.dr,
        closing_cr: closing.cr,
        opening_net: opening.dr - opening.cr,
        closing_net: closing.dr - closing.cr,
      })
    }
  }

  if (rows.length > 0) return rows

  // Report export shape used by Tally XML reports:
  // <DSPACCNAME><DSPDISPNAME>Ledger</DSPDISPNAME></DSPACCNAME>
  // <DSPACCINFO>...amount columns...</DSPACCINFO>
  const reportRegex = /<DSPACCNAME\b[^>]*>([\s\S]*?)<\/DSPACCNAME>\s*<DSPACCINFO\b[^>]*>([\s\S]*?)<\/DSPACCINFO>/gi
  let rm
  while ((rm = reportRegex.exec(xmlString)) !== null) {
    const name = tagValue(rm[1], 'DSPDISPNAME') || tagValue(rm[1], 'NAME')
    const info = rm[2]
    if (!name || /^(grand\s+total|total)$/i.test(name) || (!keepPLLedger && isProfitAndLossLedger(name))) continue

    const openingDr = Math.abs(parseAmount(tagValue(info, 'DSPOPDRAMT') || tagValue(info, 'DSPOPENINGDRAMT') || tagValue(info, 'DSPOPAMT')))
    const openingCr = Math.abs(parseAmount(tagValue(info, 'DSPOPCRAMT') || tagValue(info, 'DSPOPENINGCRAMT')))
    const debit = Math.abs(parseAmount(tagValue(info, 'DSPDRAMT') || tagValue(info, 'DSPDEBITAMT') || tagValue(info, 'DSPTRANSDRAMT')))
    const credit = Math.abs(parseAmount(tagValue(info, 'DSPCRAMT') || tagValue(info, 'DSPCREDITAMT') || tagValue(info, 'DSPTRANSCRAMT')))
    const closingDr = Math.abs(parseAmount(tagValue(info, 'DSPCLDRAMT') || tagValue(info, 'DSPCLOSINGDRAMT')))
    const closingCr = Math.abs(parseAmount(tagValue(info, 'DSPCLCRAMT') || tagValue(info, 'DSPCLOSINGCRAMT')))

    rows.push({
      name,
      opening_dr: openingDr,
      opening_cr: openingCr,
      debit,
      credit,
      closing_dr: closingDr,
      closing_cr: closingCr,
      opening_net: openingDr - openingCr,
      closing_net: closingDr - closingCr,
    })
  }
  return rows
}

// ── Parse Tally Ledger Master XML ─────────────────────────────────────────────
export function parseTallyMasterXml(xmlString) {
  const ledgerMap = {}
  const groupParent = {}
  const groupDeemedPositive = {}

  // Extract GROUP entries first. IsDeemedPositive is a genuine attribute of
  // the GROUP master (explicitly set when the group is created — reserved
  // groups like "Current Liabilities"/"Fixed Assets" have it built in, and
  // every user-created group has its own value too, never inherited). This
  // is why we resolve nature from the group, not the ledger.
  const groupRegex = /<GROUP\b([^>]*)>([\s\S]*?)<\/GROUP>/gi
  let gm
  while ((gm = groupRegex.exec(xmlString)) !== null) {
    const name = (attrValue(gm[1], 'NAME') || tagValue(gm[2], 'NAME')).trim()
    const inner = gm[2]
    const parent = tagValue(inner, 'PARENT')
    if (name) groupParent[name] = parent || null
    const gdpTag = tagValue(inner, 'ISDEEMEDPOSITIVE')
    if (name && gdpTag) groupDeemedPositive[name] = /^yes$/i.test(gdpTag)
  }

  // Chain resolver
  const chainOf = (groupName) => {
    const chain = []; let cur = groupName; let safety = 0
    while (cur && safety++ < 20) {
      chain.push(cur)
      cur = groupParent[cur]
      if (!cur) break
    }
    return chain
  }

  // Resolve nature by walking the group chain — a ledger's own ISDEEMEDPOSITIVE
  // tag is a Ledger-object FETCH of what is actually a Group-level attribute,
  // and Tally does not reliably resolve that inheritance for a raw ledger
  // FETCH, so it is used only as a last-resort fallback here, after the group
  // chain (which fetches the attribute directly from its true owner).
  const deemedPositiveOf = (groupName) => {
    let cur = groupName; let safety = 0
    while (cur && safety++ < 20) {
      if (groupDeemedPositive[cur] !== undefined) return groupDeemedPositive[cur]
      cur = groupParent[cur]
    }
    return null
  }

  // Extract LEDGER entries
  const ledgerRegex = /<LEDGER\b([^>]*)>([\s\S]*?)<\/LEDGER>/gi
  let lm
  while ((lm = ledgerRegex.exec(xmlString)) !== null) {
    const name = (attrValue(lm[1], 'NAME') || tagValue(lm[2], 'NAME')).trim()
    const inner = lm[2]
    const parent = tagValue(inner, 'PARENT')
    const hierarchy = parent ? chainOf(parent) : []
    const affectsstock = /^yes$/i.test(tagValue(inner, 'AFFECTSSTOCK'))
    let isDeemedPositive = parent ? deemedPositiveOf(parent) : null
    if (isDeemedPositive === null) {
      const isDeemedPositiveTag = tagValue(inner, 'ISDEEMEDPOSITIVE')
      isDeemedPositive = isDeemedPositiveTag ? /^yes$/i.test(isDeemedPositiveTag) : null
    }
    ledgerMap[name.trim().toLowerCase()] = { name, parent, hierarchy, affectsstock, isDeemedPositive }
  }

  return { ledgerMap, groupCount: Object.keys(groupParent).length, ledgerCount: Object.keys(ledgerMap).length }
}
