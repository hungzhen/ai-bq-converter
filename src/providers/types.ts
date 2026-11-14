/**
 * INTERPRETATION PROVIDER — the one interface every interpreter must follow.
 *
 * Today: a conventional rule-based provider (Stage 2G). Later, possibly: an AI provider
 * (e.g. Claude through a server function). The rest of the converter only talks to this
 * interface, so a future provider plugs in without changes elsewhere.
 *
 * WHAT A PROVIDER MAY DO — return DECISIONS ABOUT STRUCTURE AND MEANING:
 *   document type · table regions · what each column means · what each row is ·
 *   heading hierarchy · Trade / Cost Item / Element suggestions · how documents relate ·
 *   which claim line belongs to which BQ row.
 *
 * WHAT A PROVIDER MAY NEVER DO — supply a figure or source text:
 *   no quantity, rate, amount, unit or description. The decision types below have no place
 *   for them, and the evidence verifier rejects any answer that adds them. Figures and text are
 *   always copied from the cited cells by the converter's own code (Stage 2D parser).
 *
 * EVERY ANSWER IS A PROPOSAL:
 *   providers return status "proposed" with the cells they relied on (CellRef). Nothing a
 *   provider returns becomes approved data until it passes the evidence verifier AND a person
 *   approves it (src/core/evidence/proposals.ts).
 *
 * NO EXTERNAL SERVICE IN PHASE 2: no Claude / OpenAI / other AI API, no API key. Claude Pro and
 * Claude Code are development tools only and are never used as a runtime service.
 */
import type {
  BqRowClass,
  BqRowForClaims,
  CellRef,
  ClassificationField,
  ConverterProject,
  ExtractedTable,
  ProgressClaimRecord,
  RelationshipKind,
  SourceDocument,
  SourceDocumentType,
} from '../core/models/index.ts';

// ---------------------------------------------------------------------------------------------
// Provider identity
// ---------------------------------------------------------------------------------------------

export type ProviderKind = 'rule-based' | 'ai';

export const RULE_BASED_LABEL = 'Conventional rule-based processing';
export const AI_LABEL = 'AI interpretation — proposal only, requires approval';

export type ProviderCapability =
  | 'classifyDocument'
  | 'detectTableRegions'
  | 'mapColumns'
  | 'classifyRows'
  | 'interpretHierarchy'
  | 'suggestClassifications'
  | 'relateDocuments'
  | 'matchClaimLines';

export const ALL_CAPABILITIES: readonly ProviderCapability[] = [
  'classifyDocument', 'detectTableRegions', 'mapColumns', 'classifyRows',
  'interpretHierarchy', 'suggestClassifications', 'relateDocuments', 'matchClaimLines',
];

export interface ProviderInfo {
  /** e.g. "rule-based". */
  readonly id: string;
  /** e.g. "0.1.0". */
  readonly version: string;
  readonly kind: ProviderKind;
  /** Shown next to every decision: RULE_BASED_LABEL or AI_LABEL. */
  readonly displayLabel: string;
  /** Methods the provider really implements; the others return an empty list. */
  readonly capabilities: readonly ProviderCapability[];
  /** True if the provider sends anything over the network. Not allowed in Phase 2. */
  readonly requiresNetwork: boolean;
}

/** "id@version", stamped on every interpretation. */
export const providerStamp = (info: ProviderInfo) => `${info.id}@${info.version}`;

// ---------------------------------------------------------------------------------------------
// Decisions — structure and meaning only, never figures or source text
// ---------------------------------------------------------------------------------------------

export interface DocumentTypeDecision {
  readonly documentType: SourceDocumentType;
}

export interface TableRegionDecision {
  readonly tableId: string;
  /** The column-heading row(s) at the top of the table (one or two rows). */
  readonly headerRowIndexes: readonly number[];
  /** The same headings repeated further down (e.g. at the top of each printed page). */
  readonly repeatedHeaderRowIndexes: readonly number[];
  readonly firstDataRowIndex: number;
  readonly lastDataRowIndex: number;
  /** false = skip this table (e.g. a cover or summary sheet). */
  readonly include: boolean;
}

/** What a column holds. Names follow the Cost Library's ColumnMappingConfig, plus claim columns. */
export type ColumnRole =
  | 'itemNo' | 'description' | 'unit' | 'quantity' | 'rate' | 'amount'
  | 'baseRate' | 'baseAmount' | 'tenderRate' | 'tenderAmount' | 'profitPercent' | 'rateAfterDiscount'
  | 'billNo' | 'billTitle' | 'section' | 'element' | 'mainHeading' | 'subheading' | 'secondarySubheading'
  | 'trade' | 'costItem' | 'remarks'
  | 'additionalQuantity' | 'additionalAmount'
  | 'claimPreviousQuantity' | 'claimCurrentQuantity' | 'claimCumulativeQuantity'
  | 'claimPreviousAmount' | 'claimCurrentAmount' | 'claimCumulativeAmount'
  | 'claimPercentComplete' | 'certifiedAmount'
  | 'percentage' // a percentage column whose purpose is not otherwise determined
  | 'other' // understood, but has no FullBQItem field (e.g. a labour / material split)
  | 'unknown' // cannot be determined — needs a person
  | 'ignore';

export const COLUMN_ROLES: readonly ColumnRole[] = [
  'itemNo', 'description', 'unit', 'quantity', 'rate', 'amount',
  'baseRate', 'baseAmount', 'tenderRate', 'tenderAmount', 'profitPercent', 'rateAfterDiscount',
  'billNo', 'billTitle', 'section', 'element', 'mainHeading', 'subheading', 'secondarySubheading',
  'trade', 'costItem', 'remarks', 'additionalQuantity', 'additionalAmount',
  'claimPreviousQuantity', 'claimCurrentQuantity', 'claimCumulativeQuantity',
  'claimPreviousAmount', 'claimCurrentAmount', 'claimCumulativeAmount',
  'claimPercentComplete', 'certifiedAmount', 'percentage', 'other', 'unknown', 'ignore',
];

export interface ColumnRoleDecision {
  readonly tableId: string;
  readonly columnIndex: number;
  readonly role: ColumnRole;
}

export interface RowClassDecision {
  readonly tableId: string;
  readonly rowIndex: number;
  readonly rowClass: BqRowClass;
}

export type HierarchyLevel = 'bill' | 'section' | 'main_heading' | 'subheading' | 'secondary_subheading' | 'item' | 'continuation';

export const HIERARCHY_LEVELS: readonly HierarchyLevel[] = ['bill', 'section', 'main_heading', 'subheading', 'secondary_subheading', 'item', 'continuation'];

export interface HierarchyDecision {
  readonly tableId: string;
  readonly rowIndex: number;
  readonly level: HierarchyLevel;
  /** The row this one sits under (a heading, or the item a continuation belongs to); null = top. */
  readonly parentRowIndex: number | null;
}

/** A suggested classification label (D-008): stays blank in the BQ until a person approves it. */
export interface ClassificationSuggestionDecision {
  readonly tableId: string;
  readonly rowIndex: number;
  readonly field: ClassificationField;
  /** The suggested label (e.g. a trade code). Never a figure, unit or description. */
  readonly label: string;
}

export interface RelationshipDecision {
  readonly fromDocumentId: string;
  readonly toDocumentId: string;
  readonly kind: RelationshipKind;
}

export interface ClaimMatchDecision {
  readonly claimLineId: string;
  readonly bqRowId: string;
}

/** Every kind of decision, by name. */
export interface DecisionTypes {
  readonly documentType: DocumentTypeDecision;
  readonly tableRegion: TableRegionDecision;
  readonly columnRole: ColumnRoleDecision;
  readonly rowClass: RowClassDecision;
  readonly hierarchy: HierarchyDecision;
  readonly classificationSuggestion: ClassificationSuggestionDecision;
  readonly relationship: RelationshipDecision;
  readonly claimMatch: ClaimMatchDecision;
}

export type DecisionKind = keyof DecisionTypes;

export const DECISION_KINDS: readonly DecisionKind[] = [
  'documentType', 'tableRegion', 'columnRole', 'rowClass', 'hierarchy', 'classificationSuggestion', 'relationship', 'claimMatch',
];

// ---------------------------------------------------------------------------------------------
// Interpretation — a decision with its evidence
// ---------------------------------------------------------------------------------------------

/** Another possible reading of the same cells, offered when the evidence is ambiguous. */
export interface AlternativeInterpretation<K extends DecisionKind = DecisionKind> {
  readonly value: DecisionTypes[K];
  readonly confidence: number;
  readonly reasoning: string;
}

export interface Interpretation<K extends DecisionKind = DecisionKind> {
  readonly decisionKind: K;
  readonly value: DecisionTypes[K];
  /** 0 – 1. */
  readonly confidence: number;
  /** The cells (or rows) the decision is based on. Required — an uncited decision is rejected. */
  readonly evidence: readonly CellRef[];
  /**
   * Optional: the text the provider says each cited cell contains (same order as `evidence`).
   * The verifier checks every quote against the real cell.
   */
  readonly quotedText?: readonly string[];
  /** Plain-English reason, shown to the reviewer. */
  readonly reasoning: string;
  /**
   * Other possible readings of the same cited cells (ambiguous evidence). Each one is verified
   * like the main answer. A proposal with alternatives can only be approved by a person who
   * explicitly chooses one of the readings — never in bulk.
   */
  readonly alternatives?: readonly AlternativeInterpretation<K>[];
  readonly method: ProviderKind;
  /** "id@version" of the provider. */
  readonly providerId: string;
  /** Always "proposed" when it leaves a provider. Only a person can approve. */
  readonly status: 'proposed';
}

// ---------------------------------------------------------------------------------------------
// What providers are given (read-only)
// ---------------------------------------------------------------------------------------------

export interface DocumentContext {
  readonly project: ConverterProject;
  readonly document: SourceDocument;
  readonly tables: readonly ExtractedTable[];
  readonly signal?: AbortSignal;
}

export interface ProjectContext {
  readonly project: ConverterProject;
  readonly tables: readonly ExtractedTable[];
  readonly signal?: AbortSignal;
}

export interface ClaimMatchContext {
  readonly project: ConverterProject;
  readonly claimLines: readonly ProgressClaimRecord[];
  readonly bqRows: readonly BqRowForClaims[];
  readonly tables: readonly ExtractedTable[];
  readonly signal?: AbortSignal;
}

// ---------------------------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------------------------

export interface InterpretationProvider {
  readonly info: ProviderInfo;
  classifyDocument(ctx: DocumentContext): Promise<readonly Interpretation<'documentType'>[]>;
  detectTableRegions(ctx: DocumentContext): Promise<readonly Interpretation<'tableRegion'>[]>;
  mapColumns(ctx: DocumentContext, regions: readonly TableRegionDecision[]): Promise<readonly Interpretation<'columnRole'>[]>;
  /** `regions`: the table regions to use (e.g. as corrected by a person); when omitted the provider finds them itself. */
  classifyRows(ctx: DocumentContext, columns: readonly ColumnRoleDecision[], regions?: readonly TableRegionDecision[]): Promise<readonly Interpretation<'rowClass'>[]>;
  interpretHierarchy(ctx: DocumentContext, rows: readonly RowClassDecision[]): Promise<readonly Interpretation<'hierarchy'>[]>;
  suggestClassifications(ctx: DocumentContext, rows: readonly RowClassDecision[]): Promise<readonly Interpretation<'classificationSuggestion'>[]>;
  relateDocuments(ctx: ProjectContext): Promise<readonly Interpretation<'relationship'>[]>;
  matchClaimLines(ctx: ClaimMatchContext): Promise<readonly Interpretation<'claimMatch'>[]>;
}
