export interface Space {
  id: string;
  title: string;
  slug: string;
  status: string;
  disabled: boolean;
  liveUrl: string | null;
  liveVersionId: string | null;
  updatedAt: string;
  teamSlug: string | null;
  operation?: { id: string; status: string } | null;
}
export interface Version {
  release?: number;
  id: string;
  spaceId: string;
  number: number | null;
  status: string;
  immutableUrl: string | null;
  immutableUrlStatus: string | null;
  isCurrentProduction: boolean;
  createdAt: string;
  readyAt?: string | null;
  fileCount: number | null;
  totalBytes: number | null;
  gitCommitSha: string | null;
  message: string | null;
  branch: string | null;
  publisher: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  filesAddedCount?: number;
  filesChangedCount?: number;
  filesRemovedCount?: number;
}
export interface Page {
  hasMore: boolean;
  nextCursor: string | null;
}
export interface Account {
  connected: boolean;
  name?: string;
  canRestore?: boolean;
  hosted?: boolean;
  pendingTickets?: string[];
}
export interface Restore {
  ticket: string;
  slug: string;
  expectedLive: string;
  target: Version;
  warning: string;
}
export interface ChangedFile {
  path: string;
  state: "added" | "modified" | "deleted";
  before: { size: number | null; contentType: string | null } | null;
  after: { size: number | null; contentType: string | null } | null;
}
export interface FileComparison {
  path: string;
  before: string | null;
  after: string | null;
  beforeReason: string | null;
  afterReason: string | null;
}
export interface DeploymentComparison {
  spaceId: string;
  baseDeploymentVersionId: string;
  deploymentVersionId: string;
  baseVersionNumber: number | null;
  versionNumber: number | null;
  stats: { files: number; added: number; modified: number; deleted: number };
  files: ChangedFile[];
  file: FileComparison | null;
  pagination: Page;
}
export interface RestoreEvent {
  id: string;
  spaceId: string;
  slug: string;
  fromVersionId: string;
  toVersionId: string;
  state: string;
  operationStatus: string | null;
  createdAt: string;
  finishedAt: string | null;
}
