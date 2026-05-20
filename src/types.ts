export interface Note {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  collapsed_headings?: string | null;
  parent_id: string | null;
  is_expanded: boolean;
}
