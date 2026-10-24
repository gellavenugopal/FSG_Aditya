/**
 * Tally PPE (Fixed Assets) Import Service
 * Fetches ledgers under "Fixed Assets" group from Tally via HTTP XML
 */

import http from 'http'

const DEFAULT_PORT = 9000
const DEFAULT_HOST = 'localhost'
const TIMEOUT_MS = 12000

function tagValue(inner, tag) {
  const m = String(inner || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? unescapeXml(m[1]).trim() : ''
}

function unescapeXml(s = '') {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function parseAmount(raw) {
  const text = unescapeXml(String(raw || '')).replace(/<[^>]+>/g, ' ').trim()
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

export async function fetchFixedAssetsFromTally(company, host = DEFAULT_HOST, port = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    const xmlRequest = `
      <ENVELOPE>
        <HEADER>
          <TALLYREQUEST>CollectionMaster</TALLYREQUEST>
        </HEADER>
        <BODY>
          <IMPORTDATA>
            <REQUESTDESC>
              <REPORTNAME>LedgerList</REPORTNAME>
              <STATICVARIABLES>
                <SVCOMPANYNAME>${escapeXml(company)}</SVCOMPANYNAME>
                <SVGROUPNAME>Fixed Assets</SVGROUPNAME>
              </STATICVARIABLES>
            </REQUESTDESC>
          </IMPORTDATA>
        </IMPORTDATA>
      </ENVELOPE>
    `

    const postData = xmlRequest

    const options = {
      hostname: host,
      port: port,
      path: '/',
      method: 'POST',
      timeout: TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/xml',
        'Content-Length': Buffer.byteLength(postData),
      },
    }

    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const ledgers = parseLedgerXml(data)
          resolve(ledgers)
        } catch (err) {
          reject(new Error(`Failed to parse Tally response: ${err.message}`))
        }
      })
    })

    req.on('error', (err) => {
      reject(new Error(`Tally connection failed: ${err.message}`))
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Tally request timeout'))
    })

    req.write(postData)
    req.end()
  })
}

function escapeXml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function parseLedgerXml(xmlData) {
  const ledgers = []

  // Extract all LEDGER blocks
  const ledgerPattern = /<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi
  let match

  while ((match = ledgerPattern.exec(xmlData)) !== null) {
    const ledgerBlock = match[1]

    const name = tagValue(ledgerBlock, 'NAME')
    const group = tagValue(ledgerBlock, 'PARENT') || 'Fixed Assets'
    const openingDr = parseAmount(tagValue(ledgerBlock, 'OPENINGBALANCE'))
    const closingDr = parseAmount(tagValue(ledgerBlock, 'CLOSINGBALANCE'))

    // Parse ledger transactions to calculate additions and credits
    let totalAdditions = 0
    let totalCredits = 0

    // Extract ledger transactions from LEDGERENTRIES block
    const txnPattern = /<LEDGERENTRIES[^>]*>([\s\S]*?)<\/LEDGERENTRIES>/i
    const txnMatch = ledgerBlock.match(txnPattern)

    if (txnMatch) {
      const txnBlock = txnMatch[1]
      const entryPattern = /<ENTRY[^>]*>([\s\S]*?)<\/ENTRY>/gi
      let entryMatch

      while ((entryMatch = entryPattern.exec(txnBlock)) !== null) {
        const entry = entryMatch[1]
        const debit = parseAmount(tagValue(entry, 'DEBITAMOUNT'))
        const credit = parseAmount(tagValue(entry, 'CREDITAMOUNT'))

        if (debit > 0) totalAdditions += debit
        if (credit > 0) totalCredits += credit
      }
    }

    if (name.trim()) {
      ledgers.push({
        ledger_name: name.trim(),
        ledger_group: group.trim(),
        opening_balance: Math.round(Math.abs(openingDr) * 100) / 100,
        additions_debit: Math.round(totalAdditions * 100) / 100,
        credits: Math.round(totalCredits * 100) / 100,
        closing_balance: Math.round(Math.abs(closingDr) * 100) / 100,
      })
    }
  }

  return ledgers
}

export async function fetchFixedAssetsWithDetails(company, host = DEFAULT_HOST, port = DEFAULT_PORT) {
  // Fetch detailed ledger info including opening/closing balances and movements
  return new Promise((resolve, reject) => {
    const xmlRequest = `
      <ENVELOPE>
        <HEADER>
          <TALLYREQUEST>Export</TALLYREQUEST>
        </HEADER>
        <BODY>
          <EXPORTDATA>
            <REQUESTDESC>
              <REPORTNAME>Ledger</REPORTNAME>
              <STATICVARIABLES>
                <SVCOMPANYNAME>${escapeXml(company)}</SVCOMPANYNAME>
              </STATICVARIABLES>
              <DYNAMICVARIABLES>
                <SVFROMDATE>01-04-2020</SVFROMDATE>
                <SVTODATE>31-03-2025</SVTODATE>
              </DYNAMICVARIABLES>
              <FILTER>
                <LEDGERNAME>*</LEDGERNAME>
                <GROUP>Fixed Assets</GROUP>
              </FILTER>
            </REQUESTDESC>
          </EXPORTDATA>
        </BODY>
      </ENVELOPE>
    `

    const postData = xmlRequest

    const options = {
      hostname: host,
      port: port,
      path: '/',
      method: 'POST',
      timeout: TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/xml',
        'Content-Length': Buffer.byteLength(postData),
      },
    }

    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const ledgers = parseLedgerDetailsXml(data)
          resolve(ledgers)
        } catch (err) {
          reject(new Error(`Failed to parse Tally response: ${err.message}`))
        }
      })
    })

    req.on('error', (err) => {
      reject(new Error(`Tally connection failed: ${err.message}`))
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Tally request timeout'))
    })

    req.write(postData)
    req.end()
  })
}

function parseLedgerDetailsXml(xmlData) {
  const ledgers = []

  // Extract all LEDGER blocks with detailed information
  const ledgerPattern = /<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi
  let match

  while ((match = ledgerPattern.exec(xmlData)) !== null) {
    const ledgerBlock = match[1]

    const name = tagValue(ledgerBlock, 'NAME')
    const group = tagValue(ledgerBlock, 'PARENT') || 'Fixed Assets'

    // Get opening balance from OPENINGBALANCE tag
    const openingBalance = parseAmount(tagValue(ledgerBlock, 'OPENINGBALANCE'))
    const closingBalance = parseAmount(tagValue(ledgerBlock, 'CLOSINGBALANCE'))

    // Calculate additions and credits from transactions
    let additions = 0
    let credits = 0

    // Parse vouchers/transactions
    const voucherPattern = /<VOUCHERS[^>]*>([\s\S]*?)<\/VOUCHERS>/i
    const voucherMatch = ledgerBlock.match(voucherPattern)

    if (voucherMatch) {
      const txnPattern = /<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi
      let txnMatch

      while ((txnMatch = txnPattern.exec(voucherMatch[1])) !== null) {
        const voucher = txnMatch[1]
        const drAmount = parseAmount(tagValue(voucher, 'DEBITAMOUNT'))
        const crAmount = parseAmount(tagValue(voucher, 'CREDITAMOUNT'))

        if (drAmount > 0) additions += drAmount
        if (crAmount > 0) credits += crAmount
      }
    }

    if (name.trim()) {
      ledgers.push({
        ledger_name: name.trim(),
        ledger_group: group.trim(),
        opening_balance: Math.round(Math.abs(openingBalance) * 100) / 100,
        additions_debit: Math.round(additions * 100) / 100,
        credits: Math.round(credits * 100) / 100,
        closing_balance: Math.round(Math.abs(closingBalance) * 100) / 100,
      })
    }
  }

  return ledgers
}
