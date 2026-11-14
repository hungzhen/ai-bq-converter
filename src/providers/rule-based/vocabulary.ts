/**
 * THE RULE-BASED PROVIDER'S VOCABULARY — every word and pattern it looks for, in one place,
 * so the rules can be reviewed and extended without touching the logic.
 *
 * Headings are compared after "normalising": lower case, punctuation turned into spaces
 * (so "Rate (RM)" → "rate rm", "Item No." → "item no"). "%" is kept.
 * Malay equivalents are included where common in Malaysian BQs.
 */
import type { UnifiedTradeCategory } from '../../vendor/cost-library/taxonomy.ts';

/** Lower case, punctuation → space, spaces collapsed. "%" is kept. */
export function normaliseHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Column headings
// ---------------------------------------------------------------------------------------------

/** Basic BQ columns. `exact` patterns must match the whole heading; others match words in it. */
export const BASIC_HEADINGS = {
  itemNo: /^(item|items|no|ref|item no|item ref|item code|bil|code|mark|s no|sn|sr no)$/,
  description: /\b(description|descriptions|particulars|perkara|keterangan|scope of works?|work description|details)\b/,
  unit: /^(unit|units|uom|unit of measurement|unit of measure|unit uom|unit measure)$/,
  quantity: /\b(qty|qtys|quantity|quantities|kuantiti)\b/,
  rate: /\b(rate|rates|price|unit price|kadar)\b/,
  amount: /\b(amount|amounts|jumlah|total|sum|value|nilai)\b/,
} as const;

/** Contractor working-file columns (checked before the basic ones). */
export const WORKING_HEADINGS = {
  baseRate: /\b(cost rate|net rate|base rate|cost price|nett rate)\b/,
  tenderRate: /\b(tender rate|selling rate|sell rate|sale rate|submitted rate)\b/,
  baseAmount: /\b(cost amount|net amount|base amount|nett amount)\b/,
  tenderAmount: /\b(tender amount|selling amount|sell amount)\b/,
  profitPercent: /\b(mark ?up|markup|profit|margin)\b/,
} as const;

/** Columns that are understood but have no FullBQItem field (kept as "other"). */
export const OTHER_HEADINGS = /\b(material|materials|labour|labor|plant|subcon|sub con|sub contract|subcontract|subcontractor|supplier|quotation|quote|wastage|waste|overhead|overheads)\b/;
export const REMARKS_HEADINGS = /\b(remark|remarks|comment|comments|note|notes|catatan)\b/;
export const PERCENT_HEADINGS = /(%|\bpercent\b|\bpercentage\b|\bperatus\b)/;
export const PROGRESS_PERCENT = /(% complete|% done|\bcomplete\b|\bprogress\b|\bwork done\b|\bsiap\b)/;

/** Claim stages: in a heading, or in a group heading above it. */
export const CLAIM_STAGES = {
  previous: /\b(previous|prev|previously|last claim|earlier|terdahulu)\b/,
  current: /\b(this claim|current|this month|this period|this valuation|present claim|semasa)\b/,
  cumulative: /\b(cumulative|to date|todate|up to date|total to date|accumulated|terkumpul)\b/,
  certified: /\bcertified\b/,
} as const;

/** Group headings meaning "the contract / BQ figures" in a claim. */
export const CONTRACT_GROUP = /\b(contract|tender|original|bq|bill of quantities|kontrak)\b/;

// ---------------------------------------------------------------------------------------------
// Document type signals (looked for in short cells and headings)
// ---------------------------------------------------------------------------------------------

export const CLAIM_SIGNALS: readonly [string, RegExp][] = [
  ['previous', CLAIM_STAGES.previous],
  ['this claim / current', CLAIM_STAGES.current],
  ['cumulative / to date', CLAIM_STAGES.cumulative],
  ['% complete', PROGRESS_PERCENT],
  ['certified', /\bcertified\b/],
  ['valuation', /\bvaluation\b/],
  ['progress claim', /\b(progress claim|interim claim|payment claim|tuntutan)\b/],
  ['retention', /\bretention\b/],
];

export const WORKING_SIGNALS: readonly [string, RegExp][] = [
  ['cost / net rate', WORKING_HEADINGS.baseRate],
  ['selling / tender rate', WORKING_HEADINGS.tenderRate],
  ['markup / profit / margin', WORKING_HEADINGS.profitPercent],
  ['material', /\bmaterials?\b/],
  ['labour', /\b(labour|labor)\b/],
  ['plant', /\bplant\b/],
  ['subcontractor', /\b(subcon|sub con|subcontract|subcontractor)\b/],
  ['supplier / quotation', /\b(supplier|quotation)\b/],
  ['build-up', /\bbuild ?up\b/],
];

export const BQ_SIGNALS: readonly [string, RegExp][] = [
  ['description', BASIC_HEADINGS.description],
  ['unit', BASIC_HEADINGS.unit],
  ['qty', BASIC_HEADINGS.quantity],
  ['rate', BASIC_HEADINGS.rate],
  ['amount', BASIC_HEADINGS.amount],
  ['bill no.', /^(bill|bil)( no)? \d+/],
  ['collection', /\b(carried to collection|collection)\b/],
  ['summary', /\bsummary\b/],
];

// ---------------------------------------------------------------------------------------------
// Row text patterns (tested on normalised lower-case text; "%" kept)
// ---------------------------------------------------------------------------------------------

export const ROW_PATTERNS = {
  carriedForward: /^(carried (forward|to (collection|summary|next page))|c f|to collection|to summary)\b/,
  broughtForward: /^(brought forward|b f|from previous page)\b/,
  subtotal: /^(sub ?total|page total|jumlah kecil)\b/,
  total: /^((grand )?total|jumlah besar|total carried)\b/,
  collection: /^collection\b/,
  summary: /^(summary|ringkasan)\b/,
  pageMarker: /^(page \d+|pg \d+|continued|cont d|contd|sambungan)\b/,
  noteLabel: /^(note|notes|nota|general notes)$/,
  billHeading: /^(bill|bil)( no)? ?\d+\b/,
  sectionHeading: /^(section|element|part|bahagian) [a-z0-9]+\b/,
  provisionalSum: /\b(provisional sum|prov sum|p s)\b/,
  primeCostSum: /\b(prime cost|p c sum|pc sum)\b/,
  percentageWords: /\b(profit|attendance|allow|percentage|per cent|percent)\b/,
} as const;

// ---------------------------------------------------------------------------------------------
// Trade suggestions — keywords → Cost Library trade (and sub-trade, when one clearly fits)
// ---------------------------------------------------------------------------------------------

export interface TradeKeyword {
  readonly pattern: RegExp;
  readonly keyword: string;
  readonly trade: UnifiedTradeCategory;
  /** Must be one of the trade's sub-trades in the Cost Library (checked by a test). */
  readonly subTrade?: string;
}

/** More specific keywords first. Matching is on the normalised description. */
export const TRADE_KEYWORDS: readonly TradeKeyword[] = [
  { keyword: 'preliminaries', pattern: /\bpreliminar/, trade: '01-preliminaries' },
  { keyword: 'demolition', pattern: /\b(demolish|demolition)/, trade: '02-demolition-alteration' },
  { keyword: 'excavation', pattern: /\bexcavat/, trade: '03-earthworks-substructure', subTrade: 'Excavation' },
  { keyword: 'backfill', pattern: /\bbackfill/, trade: '03-earthworks-substructure', subTrade: 'Backfilling' },
  { keyword: 'disposal', pattern: /\b(disposal|cart away)\b/, trade: '03-earthworks-substructure', subTrade: 'Disposal' },
  { keyword: 'hardcore', pattern: /\bhardcore\b/, trade: '03-earthworks-substructure', subTrade: 'Filling' },
  { keyword: 'blinding', pattern: /\bblinding\b/, trade: '05-concrete-works', subTrade: 'Blinding Concrete' },
  { keyword: 'formwork', pattern: /\bformwork\b/, trade: '05-concrete-works' },
  { keyword: 'fabric / mesh reinforcement', pattern: /\b(brc|fabric reinforcement|mesh reinforcement|wire mesh)\b/, trade: '05-concrete-works', subTrade: 'Reinforcement Mesh' },
  { keyword: 'bar reinforcement', pattern: /\b(reinforcement|rebar|high tensile|mild steel bar)\b/, trade: '05-concrete-works', subTrade: 'Bar Reinforcement' },
  { keyword: 'reinforced concrete', pattern: /\breinforced concrete\b/, trade: '05-concrete-works', subTrade: 'Reinforced Concrete' },
  { keyword: 'concrete', pattern: /\bconcrete\b/, trade: '05-concrete-works' },
  // "pile cap(s)" is concrete work, not piling
  { keyword: 'bored pile', pattern: /\bbored pil(e|es|ing)\b(?! caps?\b)/, trade: '04-piling-geotechnical', subTrade: 'Bored Piles' },
  { keyword: 'piling', pattern: /\bpil(e|es|ing)\b(?! caps?\b)/, trade: '04-piling-geotechnical' },
  { keyword: 'brickwork', pattern: /\bbrick(work)?s?\b/, trade: '06-masonry-partitions', subTrade: 'Brickwork' },
  { keyword: 'blockwork', pattern: /\bblock ?work\b/, trade: '06-masonry-partitions', subTrade: 'Blockwork' },
  { keyword: 'structural steel', pattern: /\bstructural steel/, trade: '07-steelwork-metalwork', subTrade: 'Structural Steel' },
  { keyword: 'handrail', pattern: /\bhandrails?\b/, trade: '07-steelwork-metalwork', subTrade: 'Handrails' },
  { keyword: 'balustrade', pattern: /\bbalustrades?\b/, trade: '07-steelwork-metalwork', subTrade: 'Balustrades' },
  { keyword: 'gutter / downpipe', pattern: /\b(gutters?|downpipes?|rainwater pipes?)\b/, trade: '08-roofing', subTrade: 'Gutters & Downpipes' },
  { keyword: 'roofing', pattern: /\broof(ing)?\b/, trade: '08-roofing' },
  { keyword: 'waterproofing', pattern: /\bwaterproof/, trade: '09-waterproofing' },
  { keyword: 'door', pattern: /\bdoors?\b/, trade: '10-doors-windows-glazing' },
  { keyword: 'window', pattern: /\bwindows?\b/, trade: '10-doors-windows-glazing' },
  { keyword: 'plaster / render', pattern: /\b(plaster|render|skim coat)\b/, trade: '11-finishes', subTrade: 'Wall Finishes — Plaster & Render' },
  { keyword: 'tiling', pattern: /\btil(e|es|ing)\b/, trade: '11-finishes' },
  { keyword: 'ceiling', pattern: /\bceilings?\b/, trade: '11-finishes' },
  { keyword: 'painting', pattern: /\bpaint(ing)?\b/, trade: '12-painting-works' },
  { keyword: 'premix / asphalt', pattern: /\b(premix|asphalt)\b/, trade: '18-road-drainage' },
  { keyword: 'drain', pattern: /\bdrains?\b/, trade: '18-road-drainage' },
  { keyword: 'turfing / landscaping', pattern: /\b(turf(ing)?|landscap)/, trade: '16-external-works' },
];
