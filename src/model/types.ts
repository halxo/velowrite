export type BlockType =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bullet-list'
  | 'numbered-list'
  | 'todo'
  | 'blockquote'
  | 'callout'
  | 'toggle'
  | 'math'
  | 'code-block'
  | 'image'
  | 'table'
  | 'divider';

export type TextAlign = 'left' | 'center' | 'right';
export type PageMode = 'paginated' | 'continuous';
export type MarginPreset = 'narrow' | 'normal' | 'wide';
export type FontPreset = 'serif' | 'sans' | 'mono';
export type LineSpacingPreset = 'compact' | 'normal' | 'relaxed';
export type PageSizePreset = 'letter' | 'a4';
export type ThemeMode = 'light' | 'dark' | 'sepia';
export type ImageWidthPreset = 'inline' | 'wide' | 'full';

export interface Block {
  id: string;
  type: BlockType;
  html: string;
  text: string;
  align?: TextAlign;
  checked?: boolean;
  collapsed?: boolean;
  toggleBody?: string;
  imageAssetId?: string;
  imageCaption?: string;
  imageWidth?: ImageWidthPreset;
  tableData?: string[][];
  codeLang?: string;
  wordCount: number;
  charCount: number;
}

export interface DocumentSettings {
  pageMode: PageMode;
  margins: MarginPreset;
  font: FontPreset;
  lineSpacing: LineSpacingPreset;
  pageSize: PageSizePreset;
}

export interface DocumentModel {
  id: string;
  title: string;
  blocks: Block[];
  settings: DocumentSettings;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentSummary {
  id: string;
  title: string;
  updatedAt: number;
  wordCount: number;
  preview: string;
}

export interface DocumentSnapshot {
  id: string;
  documentId: string;
  label: string;
  title: string;
  blocks: Block[];
  wordCount: number;
  createdAt: number;
}

export interface DocumentStats {
  words: number;
  characters: number;
  readingTimeMinutes: number;
  pages: number;
  blockCount: number;
}

export interface OutlineItem {
  id: string;
  level: 1 | 2 | 3;
  text: string;
  blockIndex: number;
}

export interface UserPreferences {
  theme: ThemeMode;
  sidebarOpen: boolean;
  lastDocumentId: string | null;
  openTabIds: string[];
  splitPaneOpen: boolean;
  splitSecondaryDocId: string | null;
  focusMode: boolean;
  typewriterMode: boolean;
  dailyWordGoal: number;
  syncFolderPath: string | null;
}

export interface CaretTarget {
  blockId: string;
  offset: number;
  toEnd?: boolean;
}

export const DEFAULT_SETTINGS: DocumentSettings = {
  pageMode: 'paginated',
  margins: 'normal',
  font: 'serif',
  lineSpacing: 'normal',
  pageSize: 'letter',
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'light',
  sidebarOpen: true,
  lastDocumentId: null,
  openTabIds: [],
  splitPaneOpen: false,
  splitSecondaryDocId: null,
  focusMode: false,
  typewriterMode: false,
  dailyWordGoal: 0,
  syncFolderPath: null,
};
