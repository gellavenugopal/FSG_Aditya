import React, { useState, useEffect, useCallback, useRef } from 'react'
import { withCurrentTitleDeedsText, GN_TITLE_OLD, GN_TITLE_COMPANY } from '../../utils/generalNoteText'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'

// TableCell's default schema has no attribute for a `style="..."` on the
// <td> itself, so a plain background-color tint (used to mark which
// Financial Ratios rows are read straight off the financial statements vs.
// which are a best-effort estimate — see utils/ratios.js) is silently
// dropped the moment the HTML is parsed into the editor. Extending the
// attribute list is the documented way to keep it; verified with a real
// TipTap round-trip, not assumed.
const StyledTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null,
        parseHTML: element => element.getAttribute('style'),
        renderHTML: attributes => (attributes.style ? { style: attributes.style } : {}),
      },
    }
  },
})
import { useFinancials } from '../../hooks/useFinancials'
import { computeRatios, fmtRatioCell, fmtVariance, fmtRatioAmount, RATIO_ROWS_META } from '../../utils/ratios'
import { withoutRatioIntro } from '../../utils/ratioNoteIntro'
import { buildRatiosTableHtml, buildRatioSnapshot, refreshRatiosInNote } from '../../utils/ratioTable'
import * as XLSX from 'xlsx-js-style'
import { buildRatioBlankTemplate, buildRatioFilledWorkbook, parseRatioWorkbook } from './ratioWorkbook'
import { pointLabel } from '../../utils/pointLabel'

let _ptId = 0
const newPointId = () => `pt_${Date.now()}_${_ptId++}`

// ── Default "Significant Accounting Policies" template ─────────────────────
// Standard boilerplate points, worded generically per constitution (Company
// vs Partnership/Proprietorship/LLP) — pre-filled the first time this note
// is opened for a TB, same as any other CA-firm working-paper template.
function entityNouns(entity) {
  const disp = (entity?.constitution_display || '').toLowerCase()
  if (disp.includes('partnership')) return { entityNoun: 'the Firm', ownerNoun: 'The Partners', ownerVerb: 'are', isCompany: false }
  if (disp.includes('llp')) return { entityNoun: 'the LLP', ownerNoun: 'The Partners', ownerVerb: 'are', isCompany: false }
  if (disp.includes('propriet')) return { entityNoun: 'the business', ownerNoun: 'The Proprietor', ownerVerb: 'is', isCompany: false }
  return { entityNoun: 'the Company', ownerNoun: 'The Board of Directors', ownerVerb: 'is', isCompany: true }
}

// Small HTML builders shared by the default templates below — every point's
// body is set as TipTap `content`, so tables/lists must be real <table>/<ol>
// markup (not text that merely looks like one) to come up as editable
// tables/lists, not as inert paragraphs.
const thCell = (text) => `<th><p><strong>${text}</strong></p></th>`
const tdCell = (text, style) => `<td${style ? ` style="${style}"` : ''}><p>${text}</p></td>`
const trRow = (cells) => `<tr>${cells.join('')}</tr>`
// r.map(tdCell) would pass Array.map's (index, array) straight through as
// tdCell's (style) argument — every cell past the first column would pick up
// a bogus style="1"/"2"/... attribute. Wrapping strips those extra args.
const tableHtml = (headers, rows) =>
  `<table><tbody>${trRow(headers.map(thCell))}${rows.map(r => trRow(r.map(cell => tdCell(cell)))).join('')}</tbody></table>`
const olHtml = (items) => `<ol>${items.map(i => `<li><p>${i}</p></li>`).join('')}</ol>`

// The Financial Ratios table (styles, builder, refresh) lives in
// utils/ratioTable.js — the PDF / Excel path refreshes it too.

// Company (constitution 3): sourced from a CA-reviewed Companies Act
// working paper — "Significant Accounting Policies" (16 numbered points,
// AS-1 through AS-29 plus a Schedule III ratios table) joined with
// "Additional Disclosures" (20 numbered points, MCA's 2021 disclosure
// requirements), renumbered into one continuous sequence of points, exactly
// as the two source documents are meant to be read together. The sample
// company's own name/incorporation date/business (point 1) and its live
// ratio percentages (point 16) have been replaced with blanks for the CA to
// fill in per client; everything else is transcribed as reviewed.
function defaultPointsCompany(entity, ratios) {
  const p = (html) => `<p>${html}</p>`
  const name = entity?.name || 'The Company'
  return [
    { header: 'Company Overview', body:
      p(`${name} was incorporated under the provisions of the Companies Act, 2013 on [date of incorporation]. The Company is engaged in the business of [nature of business — e.g. manufacturing/trading of ...].`) },
    { header: 'Basis of Preparation of Financial Statements (AS-1)', body:
      p(`The financial statements have been prepared and presented taking into consideration the Fundamental Accounting Assumptions as per Accounting Standard-1 (AS-1) issued by the Institute of Chartered Accountants of India. The financial statements also comply with the accounting standards notified under Section 133 of the Companies Act, 2013 read with Rule 7 of the Companies (Accounts) Rules, 2014, to the extent applicable, and other accounting principles generally accepted in India.`) +
      p(`The Fundamental Accounting Assumptions as per AS-1 which have been followed are:`) +
      olHtml([`Assumption of Going Concern`, `Adoption of Accrual System of Accounting`, `Adoption of Rule of Consistency`]) },
    { header: 'Use of Estimates', body:
      p(`The preparation of financial statements in conformity with Generally Accepted Accounting Principles ('GAAP') requires management to make estimates and assumptions that affect the reported amounts of assets and liabilities and disclosure of contingent liabilities as of the date of the financial statements, and the reported amount of revenue and expenses during the reporting period. The estimates and assumptions used are based upon management's evaluation of the relevant facts and circumstances as on the date of the financial statements. Actual results may differ from those estimates. Any revision to accounting estimates is recognised prospectively in current and future periods. Grouping and regrouping in various heads have been done for better presentation of the financial statements.`) },
    { header: 'Valuation of Inventory (AS-2)', body:
      p(`Inventories are assets held for sale in the ordinary course of business, in the process of production for such sale, and in the form of materials or supplies to be consumed in the production process or in the rendering of services.`) +
      p(`Inventories are valued at the lower of cost and net realisable value after providing for obsolescence and other losses considered necessary. The cost of inventories includes all costs of purchase, costs of conversion and other costs incurred in bringing the inventories to their present location and condition. Work-in-progress and finished goods include an appropriate proportion of overheads.`) },
    { header: 'Depreciation', body:
      p(`Depreciation on Fixed Assets is provided on the Written Down Value (WDV) method at the rates specified in Schedule II to the Companies Act, 2013. The depreciable amount is the cost of an asset, or other amount substituted for cost, less its residual value, which has been estimated at 5% of the original cost of the asset.`) +
      p(`The useful life of the assets is taken as provided in Schedule II to the Companies Act, 2013, as under:`) +
      tableHtml(
        [`Nature of Asset`, `Useful Life Taken (In Years)`],
        [[`Plant &amp; Machinery`, `15`], [`Motor Vehicles`, `8`], [`Computers`, `3`]]
      ) +
      p(`For the purposes of computation of tax, depreciation has been calculated as per the prescribed provisions of the Income Tax Act, 1961.`) },
    { header: 'Revenue Recognition (AS-9)', body:
      p(`Sales are recognised net of returns and trade discounts, upon transfer of the significant risks and rewards of ownership to the buyer, which generally coincides with the delivery of goods to customers. Other incomes are accounted for on accrual basis unless otherwise stated.`) },
    { header: 'Fixed Assets', body:
      p(`Fixed Assets are stated at historical cost less accumulated depreciation. The cost of a fixed asset includes: purchase price, import duties and other non-refundable taxes, direct costs incurred to bring the asset to its working condition, installation cost, and professional fees (such as architects' fees) and general overheads of the enterprise when specifically attributable to the acquisition/preparation of the fixed asset.`) },
    { header: 'Treatment of Expenses', body:
      p(`All known expenses are accounted for on accrual basis.`) },
    { header: 'Investments (AS-13)', body:
      p(`Long-term investments are stated at cost less provision for diminution in the value of such investments. Diminution in value is provided for where the management is of the opinion that the diminution is of a permanent nature. Short-term investments are valued at the lower of cost and net realisable value.`) },
    { header: 'Borrowing Costs', body:
      p(`Interest and other costs incurred in connection with the borrowing of funds are charged to revenue on accrual basis, except those borrowing costs directly attributable to the acquisition or construction of fixed assets that necessarily take a substantial period of time to get ready for their intended use. Such costs are capitalised with the fixed asset.`) },
    { header: 'Related Party Disclosure', body:
      p(`Transactions with the Key Management Personnel are as under:`) +
      p(`<strong>A. Name of related parties and nature of related party relationship:</strong>`) +
      tableHtml(
        [`Sr. No.`, `Name of Related Person`, `Relation`],
        [[``, ``, ``], [``, ``, ``], [``, ``, ``], [``, ``, ``]]
      ) +
      p(`<strong>B. Transactions with the Related Party are as under:</strong>`) +
      tableHtml(
        [`Sr. No.`, `Name of Related Person`, `Relation`, `Nature of Transaction`, `Amount`],
        [[``, ``, ``, ``, ``], [``, ``, ``, ``, ``], [``, ``, ``, ``, ``], [``, ``, ``, ``, ``], [``, ``, ``, ``, ``], [``, ``, ``, ``, ``]]
      ) },
    { header: 'Earnings per Share (AS-20)', body:
      p(`Basic EPS: Basic EPS is calculated by dividing the net profit/loss for the period attributable to the equity shareholders by the weighted average number of equity shares.`) +
      p(`Diluted EPS: Diluted EPS is calculated by dividing the adjusted net profit/loss for the period attributable to the equity shareholders by the weighted average number of shares comprising equity shareholders and dilutive potential equity shares.`) +
      p(`Since there are no dilutive potential equity shares, the Basic and Diluted EPS are equal. Further, as there are no discontinuing operations, the EPS before and after discontinuing operations are the same.`) },
    { header: 'Taxes on Income & Deferred Tax Asset (AS-22)', body:
      p(`Income tax expense comprises current tax (the amount of tax for the period determined in accordance with the income tax law) and deferred tax charge or credit (reflecting the tax effect of timing differences between accounting income and taxable income for the period). The deferred tax charge or credit and the corresponding deferred tax liability or asset are recognised using the tax rates that have been enacted or substantively enacted by the balance sheet date.`) +
      p(`Deferred tax assets are recognised only to the extent there is reasonable certainty that the asset can be realised in future; however, where there is unabsorbed depreciation or carried-forward loss under taxation laws, deferred tax assets are recognised only if there is virtual certainty of realisation of such assets. Deferred tax assets are reviewed at each balance sheet date and written down or written up to reflect the amount that is reasonably/virtually certain (as the case may be) to be realised.`) +
      tableHtml(
        [`Particulars`, `Amount`],
        [[`Net Deferred Tax Asset created / DTL reversed during the year`, ``], [`Add: Opening Balance of Deferred Tax Asset`, ``], [`Total Deferred Tax Asset (Closing Balance)`, ``]]
      ) },
    { header: 'Impairment of Assets (AS-28)', body:
      p(`The management periodically assesses, using external and internal sources, whether there is an indication that an asset may be impaired. An impairment loss is recognised wherever the carrying value of an asset exceeds its recoverable amount.`) +
      p(`The recoverable amount is the higher of the asset's net selling price and its value in use, being the present value of future cash flows expected to arise from the continuing use of the asset and its eventual disposal. An impairment loss for an asset is reversed if, and only if, the reversal can be related objectively to an event occurring after the impairment loss was recognised. The carrying amount of an asset is increased to its revised recoverable amount, provided this does not exceed the carrying amount that would have been determined (net of any accumulated amortisation or depreciation) had no impairment loss been recognised for the asset in prior years.`) },
    { header: 'Provision and Contingent Liabilities (AS-29)', body:
      p(`A provision is created when there is a present obligation as a result of an obligating event that probably requires an outflow of resources and a reliable estimate can be made of the amount of the outflow.`) +
      p(`A disclosure for a contingent liability is made when there is a possible obligation, or a present obligation that may, but probably will not, require an outflow of resources. Where there is a possible obligation or a present obligation in respect of which the likelihood of an outflow of resources is remote, no provision or disclosure is made.`) },
    // The table alone — the italic working note that stood above it printed
    // in the accounts (removed 30 Sep 2026, utils/ratioNoteIntro.js).
    { header: 'Financial Ratios', body:
      buildRatiosTableHtml(ratios) },
    { header: 'Regrouping of Previous Year Figures', body:
      p(`Previous year figures have been regrouped/reclassified wherever necessary to correspond with the current year's classification.`) },
    { header: 'Method of Depreciation', body:
      p(`Depreciation has been charged under the Written Down Value (WDV) method on the basis of the useful life of the asset and after retaining the residual value as specified in Schedule II to the Companies Act, 2013.`) },
    { header: 'Expenditure in Foreign Currency', body:
      p(`Particulars of expenditure in foreign currency (\u20b9 in Lakhs): NIL`) },
    { header: 'Earnings in Foreign Exchange', body:
      p(`Earnings in foreign exchange (\u20b9 in Lakhs): NIL`) },
    { header: 'Remittance in Foreign Exchange on Account of Dividends', body:
      p(`Remittance in foreign exchange on account of dividends: NIL`) },
    { header: 'Wilful Defaulter', body:
      p(`The Company has not been declared a wilful defaulter by any bank or financial institution or other lender.`) },
    { header: 'Utilisation of Borrowed Funds \u2014 Intermediaries', body:
      p(`The Company has not advanced or loaned or invested funds to any other person(s) or entity(ies), including foreign entities (Intermediaries), with the understanding that the Intermediary shall, directly or indirectly, lend or invest in other persons or entities identified in any manner whatsoever by or on behalf of the Company (Ultimate Beneficiaries), or provide any guarantee, security or the like to or on behalf of the Ultimate Beneficiaries.`) },
    { header: 'Transactions with Struck-off Companies', body:
      p(`The Company has not entered into any transactions with another company whose name has been struck off by the Registrar of Companies.`) },
    { header: 'Registration of Charges', body:
      p(`The Company does not have any pending charge required to be registered or satisfied with the Registrar of Companies during the year.`) },
    { header: 'Scheme of Arrangements', body:
      p(`The Company does not have any Scheme of Arrangement that has been approved by the competent authority in terms of sections 230 to 237 of the Companies Act, 2013.`) },
    { header: 'Benami Property', body:
      p(`The Company does not hold any Benami property, and no proceeding has been initiated or is pending against the Company for holding any Benami property.`) },
    { header: 'Number of Layers of Companies', body:
      p(`The Company has complied with the number of layers prescribed under clause (87) of section 2 of the Companies Act, 2013 read with the Companies (Restriction on Number of Layers) Rules, 2017.`) },
    { header: 'Crypto Currency / Virtual Currency', body:
      p(`The Company has not traded or invested in Crypto currency or Virtual Currency during the financial year.`) },
    { header: 'Undisclosed Income', body:
      p(`The Company does not have any undisclosed income which is not recorded in the books of account, that has been surrendered or disclosed as income during the year (or previous year) in the tax assessments under the Income Tax Act, 1961 (such as, search or survey or any other relevant provisions of the Income Tax Act, 1961).`) },
    { header: 'Title Deeds of Immovable Property', body:
      p(`The Company does not hold any title deeds of immovable property which is not in its own name.`) },
    { header: 'Revaluation of Property, Plant & Equipment', body:
      p(`The Company has not revalued any of its Property, Plant &amp; Equipment as defined under Rule 2 of the Companies (Registered Valuers and Valuation) Rules, 2017.`) },
    { header: 'Security of Current Assets', body:
      p(`The Company has no borrowings from banks or financial institutions on the basis of security of current assets.`) },
    { header: 'Corporate Social Responsibility (CSR)', body:
      p(`The Company is not covered by Section 135 (Corporate Social Responsibility) of the Companies Act, 2013.`) },
    { header: 'Loans and Advances to Promoters', body:
      p(`The Company has not provided any loans and advances in the nature of loans to its promoters.`) },
    { header: 'Capital Work-in-Progress / Intangible Assets under Development', body:
      p(`The Company does not have any Capital Work-in-Progress (CWIP) or Intangible Assets under Development.`) },
  ].map(pt => ({ id: newPointId(), header: pt.header, contentHtml: pt.body }))
}

// Constitution 1 & 2 (Individual / Proprietorship / Partnership / LLP): the
// generic template this tool has always used — unchanged.
//
// Related Party Transaction — every non-corporate constitution (Individual,
// Proprietorship, Partnership, LLP; the CA's call on 22 Sep 2026), inserted
// as its own point right before Contingent Liability. Two hand-fillable
// sub-tables, each with 2 blank editable rows: names/relations, then
// transactions/amounts.
function relatedPartyTransactionBody() {
  return (
    `<ul><li><p><strong>Name of Related Party</strong></p></li></ul>` +
    tableHtml(['Sl. No.', 'Name of Related Party', 'Relation'], [
      ['1', '', ''],
      ['2', '', ''],
    ]) +
    `<ul><li><p><strong>Transaction with Related Party</strong></p></li></ul>` +
    tableHtml(['Sl. No.', 'Name of Related Party', 'Relation', 'Nature of Transaction', 'Amount of Transaction'], [
      ['1', '', '', '', ''],
      ['2', '', '', '', ''],
    ])
  )
}

function defaultPointsNonCorp(entity) {
  const { entityNoun, ownerNoun, ownerVerb } = entityNouns(entity)
  const p = (html) => `<p>${html}</p>`
  const points = [
    { header: 'Method of Accounting', body: p('The financial statements have been prepared as per mercantile method in accordance with the generally accepted accounting principles; unless specifically stated to be otherwise.') },
    { header: 'Fixed Assets', body: p('Fixed Assets are stated at cost net of recoverable taxes, trade discounts and rebates, less accumulated depreciation. The cost of Fixed Assets comprises its purchase price and any cost directly attributable to bringing the asset to its working condition for its intended use.') },
    { header: 'Depreciation', body: p('Depreciation on Fixed Assets is provided at the rate of depreciation prescribed in the Income Tax Rules, 1962.') },
    { header: 'Inventory', body: p('Inventories are measured at lower of cost and net realisable value. Cost of inventories comprises of cost of purchase, cost of conversion and other costs including manufacturing overheads incurred in bringing them to their respective present location and condition.') },
    { header: 'Investments', body: p('Current investments are carried at lower of cost and quoted/fair value, computed category-wise. Non-current investments are stated at cost. Provision for diminution in the value of Non-current investments is made only if such a decline is other than temporary.') },
    { header: 'Revenue Recognition', body: p(`The sale of goods is recognized at the point of dispatch of goods to the customers, which is when substantial risks and rewards of ownership are passed to the customers, and are stated net of trade discounts, rebates, rate difference and goods and service tax.`) + p('Interest income is recognized on accrual basis.') + p('Dividend income is recognized if right to receive dividend is established by the reporting date.') },
    { header: 'Purchase', body: p('The purchases are shown at cost, when the transaction of purchase takes place in accordance with the terms of purchase, net of purchase return, rebates, rate difference and goods and service tax to the extent input credit on same is available.') },
    { header: 'Income and Expenditure', body: p('All expenses and incomes to the extent considered payable and receivable respectively are accounted for on accrual basis. Major items of the expense are accounted for on time/prorata basis and necessary provisions for the same are made.') },
  ]
  points.push({ header: 'Related Party Transaction', body: relatedPartyTransactionBody() })
  points.push({ header: 'Contingent Liability', body: p(`${ownerNoun} ${ownerVerb} of the opinion that ${entityNoun} does not have any contingent liability.`) })
  return points.map(pt => ({ id: newPointId(), header: pt.header, contentHtml: pt.body }))
}

function defaultPoints(entity, ratios) {
  return entityNouns(entity).isCompany ? defaultPointsCompany(entity, ratios) : defaultPointsNonCorp(entity)
}

function ToolbarButton({ onClick, active, disabled, title, children }) {
  return (
    <button
      type="button"
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2 py-1 text-xs rounded border transition font-medium disabled:opacity-30 ${
        active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  )
}

// One rich-text box — the editor and toolbar every General Notes point uses,
// and each "Comments on Ratios" paragraph below the ratio table.
function RichText({ html, onChange, quickInsert, minH = 'min-h-[80px]' }) {
  // The latest onChange, so an edit never saves through a stale point.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Table.configure({ resizable: true }),
      TableRow, TableHeader, StyledTableCell,
    ],
    content: html || '<p></p>',
    onUpdate: ({ editor }) => onChangeRef.current(editor.getHTML()),
  })

  // The editor reads `content` only when it mounts. When the HTML is replaced
  // underneath it — the Financial Ratios table brought up to date — show that
  // here; otherwise the screen kept the old table and the next keystroke in
  // this point saved the old table back over the new one.
  useEffect(() => {
    if (!editor || editor.isFocused) return
    const next = html || '<p></p>'
    if (next !== editor.getHTML()) editor.commands.setContent(next, false)
  }, [editor, html])

  const insertText = (text) => editor?.chain().focus().insertContent(text).run()

  if (!editor) return null

  return (
    <>
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-100 flex-wrap">
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold"><b>B</b></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic"><i>I</i></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline"><u>U</u></ToolbarButton>
        <span className="w-px h-4 bg-gray-200 mx-1" />
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left">⯇</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align center">≡</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right">⯈</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justify">☰</ToolbarButton>
        <span className="w-px h-4 bg-gray-200 mx-1" />
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">• List</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">1. List</ToolbarButton>
        <span className="w-px h-4 bg-gray-200 mx-1" />
        <ToolbarButton onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert table">▦ Table</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().addRowAfter().run()} disabled={!editor.can().addRowAfter()} title="Add row">+Row</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().deleteRow().run()} disabled={!editor.can().deleteRow()} title="Delete current row">−Row</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().addColumnAfter().run()} disabled={!editor.can().addColumnAfter()} title="Add column">+Col</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().deleteColumn().run()} disabled={!editor.can().deleteColumn()} title="Delete current column">−Col</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().deleteTable().run()} disabled={!editor.can().deleteTable()} title="Delete table">✕Table</ToolbarButton>
        <span className="w-px h-4 bg-gray-200 mx-1" />
        <ToolbarButton onClick={() => insertText(quickInsert.entityName)} title="Insert entity name">+ Entity</ToolbarButton>
        <ToolbarButton onClick={() => insertText(quickInsert.auditorName)} disabled={!quickInsert.auditorName} title="Insert auditor name">+ Auditor</ToolbarButton>
        <ToolbarButton onClick={() => insertText(quickInsert.signatoryName)} disabled={!quickInsert.signatoryName} title="Insert signatory name">+ Signatory</ToolbarButton>
      </div>

      <div className={`px-4 py-3 ${minH} max-h-[420px] overflow-y-auto overflow-x-auto tiptap-editor`} onClick={() => editor.chain().focus().run()}>
        <div className="prose prose-sm max-w-none">
          <EditorContent editor={editor} />
        </div>
      </div>
    </>
  )
}

let _commentId = 0
const newCommentId = () => `c_${Date.now()}_${_commentId++}`
const isRatiosPoint = (point) => (point?.header || '').trim().toLowerCase() === 'financial ratios'

function Point({ point, displayNum, onChange, onRemove, onMove, isFirst, isLast, quickInsert }) {
  const comments = point.comments || []
  const setComments = (next) => onChange({ ...point, comments: next })
  const removeComment = (i) => {
    if (!window.confirm('Remove this comment paragraph?')) return
    setComments(comments.filter((_, ci) => ci !== i))
  }

  return (
    <div className="border border-gray-300 rounded-lg mb-4 bg-white shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50 rounded-t-lg">
        <span
          title="Assigned automatically by position within this note"
          className="w-9 h-7 flex items-center justify-center text-xs font-bold border border-gray-300 rounded bg-gray-100 text-gray-700 shrink-0"
        >{displayNum}</span>
        <input
          type="text"
          value={point.header || ''}
          onChange={e => onChange({ ...point, header: e.target.value })}
          placeholder="Topic (e.g. Method of Accounting)"
          className="flex-1 px-2 py-1 text-xs font-semibold border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <button onClick={() => onMove(-1)} disabled={isFirst} title="Move up" className="text-gray-400 hover:text-gray-700 disabled:opacity-20 text-xs px-1">▲</button>
        <button onClick={() => onMove(1)} disabled={isLast} title="Move down" className="text-gray-400 hover:text-gray-700 disabled:opacity-20 text-xs px-1">▼</button>
        <button onClick={onRemove} title="Remove this point" className="text-red-400 hover:text-red-600 text-xs px-1.5">✕ Remove</button>
      </div>

      <RichText html={point.contentHtml} onChange={(html) => onChange({ ...point, contentHtml: html })} quickInsert={quickInsert} />

      {/* Financial Ratios: the CA's comments below the ratio table — each its
          own paragraph with the full editor; printed below the table, never
          touched when the table is brought up to date (utils/generalNotePoint.js). */}
      {(isRatiosPoint(point) || comments.length > 0) && (
        <div className="border-t border-gray-200 bg-gray-50/60 px-3 py-2 rounded-b-lg">
          <div className="text-[11px] font-semibold text-gray-600 mb-2">Comments on Ratios <span className="font-normal text-gray-400">— printed below the table</span></div>
          {comments.map((c, i) => (
            <div key={c.id} className="border border-gray-200 rounded bg-white mb-2">
              <div className="flex items-center justify-between px-3 py-1 border-b border-gray-100 bg-gray-50">
                <span className="text-[10px] text-gray-500">Paragraph {i + 1}</span>
                <button onClick={() => removeComment(i)} title="Remove this paragraph" className="text-red-400 hover:text-red-600 text-[10px]">✕ Remove</button>
              </div>
              <RichText html={c.html} minH="min-h-[60px]" quickInsert={quickInsert}
                onChange={(html) => setComments(comments.map((x, xi) => (xi === i ? { ...x, html } : x)))} />
            </div>
          ))}
          <button onClick={() => setComments([...comments, { id: newCommentId(), html: '<p></p>' }])}
            className="text-xs px-2 py-1 border border-blue-400 text-blue-700 rounded hover:bg-blue-50">+ Add Comment Paragraph</button>
        </div>
      )}
    </div>
  )
}

// A Company's General Notes carries the Additional Regulatory Information too, and its heading says so
const defaultTitleFor = (entity) => (entityNouns(entity).isCompany ? GN_TITLE_COMPANY : GN_TITLE_OLD)

export default function GeneralNotes({ entity, activeTB, prevTB, activeRsId }) {
  const [note, setNote] = useState(null) // { title, points: [...] }
  const [saveStatus, setSaveStatus] = useState('')
  const [auditors, setAuditors] = useState([])
  const [signatories, setSignatories] = useState([])
  const saveTimer = useRef(null)

  const entityPeriodId = activeTB?.entity_period_id
  // Only Company's default template has a ratios table, but the hook itself
  // is cheap to call for every constitution (same as BS/PL always do).
  const { data: finData, loading: finLoading } = useFinancials(activeTB, prevTB, entity, activeRsId)

  useEffect(() => {
    if (!entity?.id) return
    window.api?.listAuditors(entity.id).then(setAuditors).catch(() => setAuditors([]))
    window.api?.listSignatories(entity.id).then(setSignatories).catch(() => setSignatories([]))
  }, [entity?.id])

  useEffect(() => {
    if (!entity?.id || !entityPeriodId) { setNote(null); return }
    // For a Company, wait for the financials fetch to finish before seeding
    // a brand-new note, so the Financial Ratios point can be filled with
    // real figures on this very first save instead of the blank template
    // (which the CA would otherwise have to notice and refresh by hand).
    // Every other constitution's template doesn't use financials at all, so
    // it never waits. Re-fires once finLoading flips to false.
    const waitingOnFinancials = entityNouns(entity).isCompany && finLoading
    window.api?.getGeneralNotes(entity.id, entityPeriodId).then(saved => {
      if (saved && saved.points?.length) {
        // The old italic working note above the ratios table goes, once; the
        // Financial Ratios table follows the financial statements as they
        // are now (utils/ratioTable.js) — every other point is untouched.
        let clean = withoutRatioIntro(saved)
        if (entityNouns(entity).isCompany) clean = withCurrentTitleDeedsText(clean)   // a point still on the old standard wording takes the current one
        if (!finLoading && finData) clean = refreshRatiosInNote(clean, finData)
        setNote(clean)
        if (clean !== saved) window.api?.saveGeneralNotes(entity.id, entityPeriodId, clean).catch(err => console.error('Failed to save General Notes:', err))
        return
      }
      if (waitingOnFinancials) return
      // Nothing saved yet — the prefilled default template only exists on
      // screen until something is actually edited (persist() below is what
      // triggers a save), so PDF/Excel generation would silently see
      // nothing. Save it immediately so it's already in the DB the first
      // time this note is ever opened, not just once the CA edits a field.
      const initialRatios = computeRatios(finData)
      const defaultNote = { title: defaultTitleFor(entity), position: 'first', points: defaultPoints(entity, initialRatios), ratioAutoSnapshot: buildRatioSnapshot(initialRatios) }
      setNote(defaultNote)
      window.api?.saveGeneralNotes(entity.id, entityPeriodId, defaultNote).catch(err => console.error('Failed to save default General Notes template:', err))
    }).catch(() => {
      if (waitingOnFinancials) return
      const initialRatios = computeRatios(finData)
      setNote({ title: defaultTitleFor(entity), position: 'first', points: defaultPoints(entity, initialRatios), ratioAutoSnapshot: buildRatioSnapshot(initialRatios) })
    })
  }, [entity?.id, entityPeriodId, finLoading, finData])

  const persist = useCallback((next) => {
    setNote(next)
    if (!entity?.id || !entityPeriodId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      window.api?.saveGeneralNotes(entity.id, entityPeriodId, next)
        .then(() => setSaveStatus('Saved'))   // quiet and permanent — no flashing message while typing
        .catch(err => { console.error('Failed to save General Notes:', err); setSaveStatus('Error saving') })
    }, 600)
  }, [entity?.id, entityPeriodId])

  const updatePoint = (idx, updated) => {
    const points = note.points.map((p, i) => i === idx ? updated : p)
    persist({ ...note, points })
  }

  const addPoint = () => {
    persist({ ...note, points: [...note.points, { id: newPointId(), header: '', contentHtml: '<p></p>' }] })
  }

  const removePoint = (idx) => {
    if (!window.confirm('Remove this point?')) return
    persist({ ...note, points: note.points.filter((_, i) => i !== idx) })
  }

  const movePoint = (idx, dir) => {
    const points = [...note.points]
    const target = idx + dir
    if (target < 0 || target >= points.length) return
    ;[points[idx], points[target]] = [points[target], points[idx]]
    persist({ ...note, points })
  }

  // The default template (defaultPoints, above) only ever seeds a BRAND NEW
  // note — once something is saved for this entity/period, opening the tab
  // just loads it, same as any CA-edited note would. This is the deliberate
  // escape hatch for "I want the tool's current standard template here
  // instead", e.g. after Company's template was rewritten but this entity
  // already had the old one on file. It discards every point on screen, so
  // it asks first, in plain terms, before touching anything.
  const resetToDefault = () => {
    if (!window.confirm(
      `Reset "${note.title || 'this note'}" to the tool's current standard template?\n\n` +
      `This replaces every point below with the default wording for ${entity?.constitution_display || 'this constitution'} — anything you've typed or changed here will be gone. This cannot be undone.`
    )) return
    persist({ title: defaultTitleFor(entity), position: 'first', points: defaultPoints(entity, computeRatios(finData)) })
  }

  // Scoped alternative to resetToDefault: only the Financial Ratios point's
  // table is recomputed and replaced, so re-pulling figures after the TB
  // changes doesn't discard anything the CA typed elsewhere in this note.
  // Recomputes the Financial Ratios table from the financial statements, but
  // a row the CA has hand-typed a different Numerator/Denominator Value into
  // since the last auto-fill is left exactly as typed (styled violet) rather
  // than silently overwritten — detected by diffing the table's current
  // figures against note.ratioAutoSnapshot, the baseline this same function
  // (and the initial template) last wrote in. Only Numerator/Denominator
  // Value can be overridden this way; Current Year/Previous Year/Variance %
  // are always recomputed from whichever Numerator/Denominator Value ends up
  // in play (freshly pulled or hand-typed) so the row stays internally
  // consistent.
  const refreshRatios = () => {
    const idx = note.points.findIndex(pt => (pt.header || '').trim() === 'Financial Ratios')
    if (idx === -1) {
      window.alert('No point titled exactly "Financial Ratios" was found in this note. Rename a point\'s header to "Financial Ratios", or use "Reset to Default Template" to restore the standard one.')
      return
    }
    if (!computeRatios(finData)) {
      window.alert('Could not read figures from the financial statements yet \u2014 make sure a Trial Balance is loaded and finished loading, then try again.')
      return
    }
    persist(refreshRatiosInNote(note, finData))
  }

  const saveRatioWorkbook = async (wb, defaultPath) => {
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const result = await window.api?.saveFileDialog({ defaultPath, filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }] })
    if (result?.filePath && buf) {
      await window.api?.writeFile(result.filePath, Array.from(new Uint8Array(buf)))
      return true
    }
    return false
  }

  // A blank, reusable template — just the 11 Particulars/Numerator/
  // Denominator rows, no figures — for filling in by hand or reusing on
  // another Company.
  const downloadRatioTemplate = async () => {
    try {
      const saved = await saveRatioWorkbook(buildRatioBlankTemplate(), 'Financial_Ratios_Template.xlsx')
      if (saved) { setSaveStatus('Template saved'); setTimeout(() => setSaveStatus(''), 1500) }
    } catch (e) { window.alert('Download failed: ' + (e?.message || '')) }
  }

  // A snapshot of whatever the Financial Ratios point currently shows
  // (freshly computed or previously hand-edited) — for reviewing/adjusting
  // in Excel before uploading it back.
  const downloadRatioFilled = async () => {
    try {
      const eName = (entity?.name || 'Entity').replace(/[^A-Za-z0-9]+/g, '_')
      const saved = await saveRatioWorkbook(buildRatioFilledWorkbook(computeRatios(finData)), `${eName}_Financial_Ratios.xlsx`)
      if (saved) { setSaveStatus('Saved'); setTimeout(() => setSaveStatus(''), 1500) }
    } catch (e) { window.alert('Download failed: ' + (e?.message || '')) }
  }

  // Reads a filled-in workbook back and rebuilds ONLY the Financial Ratios
  // point from it — same scoped-replace as refreshRatios, so the rest of
  // the note (and anything typed into other points) is never touched.
  const uploadRatioTemplate = async () => {
    try {
      const result = await window.api?.openFileDialog({ filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xls'] }], properties: ['openFile'] })
      const filePath = result?.filePaths?.[0]
      if (!filePath) return
      const bytes = await window.api?.readFile(filePath)
      const wb = XLSX.read(new Uint8Array(bytes), { type: 'array' })
      const { rows: parsedRows, matched, unmatched, extraRows } = parseRatioWorkbook(wb)

      const idx = note.points.findIndex(pt => (pt.header || '').trim() === 'Financial Ratios')
      if (idx === -1) {
        window.alert('No point titled exactly "Financial Ratios" was found in this note. Rename a point\'s header to "Financial Ratios", or use "Reset to Default Template" to restore the standard one.')
        return
      }
      const rebuilt = defaultPointsCompany(entity, parsedRows).find(pt => pt.header === 'Financial Ratios')
      const points = note.points.map((pt, i) => i === idx ? { ...pt, contentHtml: rebuilt.contentHtml } : pt)
      persist({ ...note, points })

      let msg = `Uploaded \u2014 ${matched} of ${RATIO_ROWS_META.length} rows matched.`
      if (unmatched.length) msg += ` Not found in the file (left blank): ${unmatched.join(', ')}.`
      if (extraRows.length) msg += ` Ignored row(s) that don't match a known ratio: ${extraRows.join(', ')}.`
      window.alert(msg)
    } catch (e) { window.alert('Upload failed: ' + (e?.message || '')) }
  }

  if (!activeTB) return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Load a Trial Balance in the Actual TB tab first.</div>
  if (!note) return <div className="flex items-center justify-center h-full text-gray-400">Loading...</div>

  const primaryAuditor = auditors[0]
  const primarySignatory = signatories[0]
  const quickInsert = {
    entityName: entity?.name || '',
    auditorName: primaryAuditor ? `${primaryAuditor.firm_name || ''}${primaryAuditor.firm_name ? ', ' : ''}${primaryAuditor.name || ''}` : '',
    signatoryName: primarySignatory ? `${primarySignatory.name || ''}${primarySignatory.designation ? ' (' + primarySignatory.designation + ')' : ''}` : '',
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      <div className="flex-shrink-0 bg-white border-b border-gray-300 px-6 py-4">
        <div className="flex justify-between items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <span className="w-16 h-8 flex items-center justify-center text-xs font-bold border border-gray-300 rounded bg-gray-100 text-gray-700 shrink-0">
              Note {note.position === 'last' ? '(Last)' : '1'}
            </span>
            <input
              type="text"
              value={note.title}
              onChange={e => persist({ ...note, title: e.target.value })}
              className="flex-1 max-w-md px-2 py-1.5 text-sm font-bold border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="Note title (e.g. Significant Accounting Policies)"
            />
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {/* Saves happen by themselves as you type. Only a failure is loud; otherwise a small grey tick that stays put. */}
            {saveStatus && (saveStatus.includes('Error')
              ? <span className="text-xs font-medium text-red-600">{saveStatus}</span>
              : <span className="text-[11px] text-gray-400 w-14 text-right" title="Changes are saved automatically">✓ {saveStatus}</span>)}
            {entityNouns(entity).isCompany && (
              <>
                <button
                  onClick={refreshRatios}
                  disabled={finLoading}
                  title="Recompute only the Financial Ratios table's Current Year / Previous Year / Variance % from the financial statements — every other point is left exactly as it is"
                  className="px-3 py-2 border border-gray-300 text-gray-600 rounded hover:bg-gray-50 hover:text-blue-700 hover:border-blue-300 transition text-sm font-medium disabled:opacity-40"
                >↻ Refresh Ratios from Financials</button>
                <button
                  onClick={downloadRatioTemplate}
                  title="Download a blank Financial Ratios workbook — just the 11 rows and column headers, no figures"
                  className="px-3 py-2 border border-gray-300 text-gray-600 rounded hover:bg-gray-50 hover:text-blue-700 hover:border-blue-300 transition text-sm font-medium"
                >⬇ Ratio Template</button>
                <button
                  onClick={downloadRatioFilled}
                  title="Download the Financial Ratios table exactly as it currently reads, to review or edit in Excel"
                  className="px-3 py-2 border border-gray-300 text-gray-600 rounded hover:bg-gray-50 hover:text-blue-700 hover:border-blue-300 transition text-sm font-medium"
                >⬇ Filled</button>
                <button
                  onClick={uploadRatioTemplate}
                  title="Upload a filled-in Financial Ratios workbook — rebuilds only the Financial Ratios point from it, every other point is left exactly as it is"
                  className="px-3 py-2 border border-gray-300 text-gray-600 rounded hover:bg-gray-50 hover:text-blue-700 hover:border-blue-300 transition text-sm font-medium"
                >⬆ Upload Ratio Template</button>
              </>
            )}
            <button
              onClick={resetToDefault}
              title="Discard every point below and reload the tool's current standard template for this constitution"
              className="px-3 py-2 border border-gray-300 text-gray-600 rounded hover:bg-gray-50 hover:text-red-600 hover:border-red-300 transition text-sm font-medium"
            >↺ Reset to Default Template</button>
            <button onClick={addPoint} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm font-medium">+ Add Point</button>
          </div>
        </div>
        <div className="flex items-center gap-4 mt-2">
          <span className="text-xs text-gray-500">
            This whole section is a single note, with every point below lettered (a), (b), (c)... within it.
          </span>
          <div className="flex items-center gap-1 rounded border border-gray-300 overflow-hidden shrink-0">
            <button
              onClick={() => persist({ ...note, position: 'first' })}
              className={`px-2 py-1 text-[11px] font-medium transition ${(!note.position || note.position === 'first') ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              title="Occupies Note 1 — every other note (Share Capital, PPE, etc.) is pushed down to start from Note 2"
            >Note 1</button>
            <button
              onClick={() => persist({ ...note, position: 'last' })}
              className={`px-2 py-1 text-[11px] font-medium transition border-l border-gray-300 ${note.position === 'last' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              title="Appended after every other note — everything else keeps its usual numbering unchanged"
            >Note (Last)</button>
          </div>
        </div>
        <div className="mt-1 text-[11px] text-gray-400">
          {entity?.name} {primaryAuditor ? `· Auditor: ${primaryAuditor.firm_name || primaryAuditor.name}` : ''} {primarySignatory ? `· Signatory: ${primarySignatory.name}` : ''}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {note.points.map((pt, idx) => (
          <Point
            key={pt.id}
            point={pt}
            displayNum={pointLabel(idx)}
            onChange={(updated) => updatePoint(idx, updated)}
            onRemove={() => removePoint(idx)}
            onMove={(dir) => movePoint(idx, dir)}
            isFirst={idx === 0}
            isLast={idx === note.points.length - 1}
            quickInsert={quickInsert}
          />
        ))}
        {note.points.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-10">No points yet — click "+ Add Point" to start.</div>
        )}
      </div>
    </div>
  )
}
