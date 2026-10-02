// AUTO-GENERATED — do not edit by hand

export interface ChannelReadState {
  channel_id?: string;
  last_read_message_id?: string;
  unread_count?: number;
  user_id?: string;
}

export interface Channels {
  created_at?: string;
  created_by?: string;
  id?: string;
  internal_only?: boolean;
  kind?: string;
  name?: string;
  project_id?: string;
  status?: string;
}

export interface FileVersions {
  file_id?: string;
  id?: string;
  size_bytes?: string;
  storage_key?: string;
  uploaded_at?: string;
  uploaded_by?: string;
  version_number?: number;
}

export interface Files {
  current_version_id?: string;
  deleted_at?: string;
  folder_id?: string;
  id?: string;
  mime_type?: string;
  name?: string;
  project_id?: string;
}

export interface Folders {
  created_by?: string;
  deleted_at?: string;
  id?: string;
  name?: string;
  parent_id?: string;
  project_id?: string;
}

export interface Invitations {
  email?: string;
  expires_at?: string;
  id?: string;
  invited_by?: string;
  project_id?: string;
  status?: string;
  token_hash?: string;
}

export interface MessageAttachments {
  file_id?: string;
  id?: string;
  message_id?: string;
}

export interface Messages {
  author_id?: string;
  body_html?: string;
  channel_id?: string;
  created_at?: string;
  deleted_at?: string;
  edited_at?: string;
  id?: string;
}

export interface Organizations {
  created_at?: string;
  id?: string;
  is_internal?: boolean;
  name?: string;
  type?: string;
}

export interface ProjectMembers {
  added_at?: string;
  project_id?: string;
  user_id?: string;
}

export interface Projects {
  created_at?: string;
  created_by?: string;
  id?: string;
  name?: string;
  organization_id?: string;
  status?: string;
}

export interface QuestionResolutions {
  channel_id?: string;
  resolved_at?: string;
  resolved_by?: string;
  side?: string;
}

export interface References {
  annotations?: string;
  author_id?: string;
  file_version_id?: string;
  id?: string;
  message_id?: string;
  page_number?: number;
  updated_at?: string;
}

export interface Users {
  active?: boolean;
  created_at?: string;
  display_name?: string;
  email?: string;
  id?: string;
  organization_id?: string;
  password_hash?: string;
  role?: string;
}

export const ENTITY_NAMES = ['channel_read_state', 'channels', 'file_versions', 'files', 'folders', 'invitations', 'message_attachments', 'messages', 'organizations', 'project_members', 'projects', 'question_resolutions', 'references', 'users'] as const;
