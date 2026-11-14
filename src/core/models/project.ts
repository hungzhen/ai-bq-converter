/**
 * CONVERTER PROJECT — one construction project with any number of source files.
 *
 * A project holds its source documents (BQs, working files, claims; Excel, CSV or PDF) and
 * the relationships between them (e.g. "claim 5 is against BQ file A"). Every source
 * reference used in the project can be checked against this list, so a value can always be
 * traced to a file that really belongs to the project.
 */
import { frozenCopy } from '../../lib/immutable.ts';
import type { SourceDocument, SourceReference } from './source.ts';

export type RelationshipKind = 'claim_against' | 'working_file_of' | 'addendum_to' | 'supersedes' | 'duplicate_of';

export interface DocumentRelationship {
  readonly id: string;
  /** e.g. the claim file … */
  readonly fromDocumentId: string;
  /** … is "claim_against" this BQ file. */
  readonly toDocumentId: string;
  readonly kind: RelationshipKind;
  readonly status: 'suggested' | 'confirmed';
  readonly note?: string;
}

export interface ConverterProject {
  readonly id: string;
  readonly name: string;
  /** "YYYY Q#" (e.g. "2024 Q1"), entered by a person. null until entered — never assumed. */
  readonly projectYear: string | null;
  readonly organizationId: string | null;
  readonly documents: readonly SourceDocument[];
  readonly relationships: readonly DocumentRelationship[];
}

export class ProjectError extends Error {
  override name = 'ProjectError';
}

/** The FullBQItem project year format, e.g. "2024 Q1". */
export const isValidProjectYearFormat = (value: string): boolean => /^\d{4} Q[1-4]$/.test(value);

export function createProject(input: { id: string; name: string; projectYear?: string | null; organizationId?: string | null }): ConverterProject {
  if (input.id.trim() === '') throw new ProjectError('A project needs an id.');
  if (input.name.trim() === '') throw new ProjectError('A project needs a name.');
  const projectYear = input.projectYear ?? null;
  if (projectYear !== null && !isValidProjectYearFormat(projectYear)) {
    throw new ProjectError(`Project year must look like "2024 Q1" (got "${projectYear}").`);
  }
  return frozenCopy({
    id: input.id,
    name: input.name,
    projectYear,
    organizationId: input.organizationId ?? null,
    documents: [],
    relationships: [],
  });
}

export function setProjectYear(project: ConverterProject, projectYear: string): ConverterProject {
  if (!isValidProjectYearFormat(projectYear)) {
    throw new ProjectError(`Project year must look like "2024 Q1" (got "${projectYear}").`);
  }
  return frozenCopy({ ...project, projectYear });
}

/** Adds one file to the project. Returns a NEW project; the old one is unchanged. */
export function addSourceDocument(project: ConverterProject, document: SourceDocument): ConverterProject {
  if (document.projectId !== project.id) {
    throw new ProjectError(`"${document.fileName}" belongs to another project.`);
  }
  if (project.documents.some((d) => d.id === document.id)) {
    throw new ProjectError(`A document with id "${document.id}" is already in the project.`);
  }
  return frozenCopy({ ...project, documents: [...project.documents, document] });
}

export function findDocument(project: ConverterProject, documentId: string): SourceDocument | undefined {
  return project.documents.find((d) => d.id === documentId);
}

/** Files uploaded more than once (same SHA-256 fingerprint), grouped. Reported, never merged silently. */
export function findDuplicateContent(project: ConverterProject): SourceDocument[][] {
  const bySha = new Map<string, SourceDocument[]>();
  for (const d of project.documents) bySha.set(d.sha256, [...(bySha.get(d.sha256) ?? []), d]);
  return [...bySha.values()].filter((group) => group.length > 1);
}

export function addRelationship(project: ConverterProject, relationship: DocumentRelationship): ConverterProject {
  for (const id of [relationship.fromDocumentId, relationship.toDocumentId]) {
    if (!findDocument(project, id)) throw new ProjectError(`Document "${id}" is not in the project.`);
  }
  if (relationship.fromDocumentId === relationship.toDocumentId) {
    throw new ProjectError('A document cannot be related to itself.');
  }
  return frozenCopy({ ...project, relationships: [...project.relationships, relationship] });
}

/**
 * Checks that every reference points to a document of this project, with the same file
 * name and document type. Returns plain-English problems (empty = all traceable).
 */
export function checkReferencesBelongToProject(project: ConverterProject, refs: readonly SourceReference[]): string[] {
  const problems: string[] = [];
  for (const ref of refs) {
    const doc = findDocument(project, ref.documentId);
    if (!doc) {
      problems.push(`Reference to unknown document "${ref.documentId}" (${ref.fileName}).`);
      continue;
    }
    if (doc.fileName !== ref.fileName) problems.push(`Reference names "${ref.fileName}" but document "${doc.id}" is "${doc.fileName}".`);
    if (doc.documentType !== ref.documentType) problems.push(`Reference says "${ref.documentType}" but "${doc.fileName}" is "${doc.documentType}".`);
    const formatOk =
      (ref.kind === 'worksheet' && (doc.format === 'xlsx' || doc.format === 'xls')) ||
      (ref.kind === 'csv' && doc.format === 'csv') ||
      (ref.kind === 'pdf' && doc.format === 'pdf');
    if (!formatOk) problems.push(`A ${ref.kind} reference cannot point into "${doc.fileName}" (${doc.format}).`);
  }
  return problems;
}
