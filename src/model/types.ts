export type BlockType =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bullet-list'
  | 'numbered-list'
  | 'blockquote'
  | 'code-block'
  | 'divider';

export type TextAlign = 'left' | 'center' | 'right';
export type PageMode = 'paginated' | 'continuous';
export type MarginPreset = 'narrow' | 'normal' | 'wide';
export type FontPreset = 'serif' | 'sans' | 'mono';
export type ThemeMode = 'light' | 'dark' | 'sepia';

export interface Block {
  id: string;
  type: BlockType;
  html: string;
  text: string;
  align?: TextAlign;
  wordCount: number;
  charCount: number;
}

export interface DocumentSettings {
  pageMode: PageMode;
  margins: MarginPreset;
  font: FontPreset;
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
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'light',
  sidebarOpen: true,
  lastDocumentId: null,
};
