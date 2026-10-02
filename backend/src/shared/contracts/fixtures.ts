// AUTO-GENERATED — do not edit by hand

import type { ChannelReadState, Channels, FileVersions, Files, Folders, Invitations, MessageAttachments, Messages, Organizations, ProjectMembers, Projects, QuestionResolutions, References, Users } from './entities';

export const channel_read_stateFixture: ChannelReadState = {
  channel_id: 'channel_id-1',
  last_read_message_id: 'last_read_message_id-1',
  unread_count: 1,
  user_id: 'user_id-1',
};

export const channelsFixture: Channels = {
  created_at: 'created_at-1',
  created_by: 'created_by-1',
  id: 'channels-1',
  internal_only: true,
  kind: 'kind-1',
  name: 'name-1',
  project_id: 'project_id-1',
  status: 'status-1',
};

export const file_versionsFixture: FileVersions = {
  file_id: 'file_id-1',
  id: 'file_versions-1',
  size_bytes: 'size_bytes-1',
  storage_key: 'storage_key-1',
  uploaded_at: 'uploaded_at-1',
  uploaded_by: 'uploaded_by-1',
  version_number: 1,
};

export const filesFixture: Files = {
  current_version_id: 'current_version_id-1',
  deleted_at: 'deleted_at-1',
  folder_id: 'folder_id-1',
  id: 'files-1',
  mime_type: 'mime_type-1',
  name: 'name-1',
  project_id: 'project_id-1',
};

export const foldersFixture: Folders = {
  created_by: 'created_by-1',
  deleted_at: 'deleted_at-1',
  id: 'folders-1',
  name: 'name-1',
  parent_id: 'parent_id-1',
  project_id: 'project_id-1',
};

export const invitationsFixture: Invitations = {
  email: 'email-1',
  expires_at: 'expires_at-1',
  id: 'invitations-1',
  invited_by: 'invited_by-1',
  project_id: 'project_id-1',
  status: 'status-1',
  token_hash: 'token_hash-1',
};

export const message_attachmentsFixture: MessageAttachments = {
  file_id: 'file_id-1',
  id: 'message_attachments-1',
  message_id: 'message_id-1',
};

export const messagesFixture: Messages = {
  author_id: 'author_id-1',
  body_html: 'body_html-1',
  channel_id: 'channel_id-1',
  created_at: 'created_at-1',
  deleted_at: 'deleted_at-1',
  edited_at: 'edited_at-1',
  id: 'messages-1',
};

export const organizationsFixture: Organizations = {
  created_at: 'created_at-1',
  id: 'organizations-1',
  is_internal: true,
  name: 'name-1',
  type: 'type-1',
};

export const project_membersFixture: ProjectMembers = {
  added_at: 'added_at-1',
  project_id: 'project_id-1',
  user_id: 'user_id-1',
};

export const projectsFixture: Projects = {
  created_at: 'created_at-1',
  created_by: 'created_by-1',
  id: 'projects-1',
  name: 'name-1',
  organization_id: 'organization_id-1',
  status: 'status-1',
};

export const question_resolutionsFixture: QuestionResolutions = {
  channel_id: 'channel_id-1',
  resolved_at: 'resolved_at-1',
  resolved_by: 'resolved_by-1',
  side: 'side-1',
};

export const referencesFixture: References = {
  annotations: 'annotations-1',
  author_id: 'author_id-1',
  file_version_id: 'file_version_id-1',
  id: 'references-1',
  message_id: 'message_id-1',
  page_number: 1,
  updated_at: 'updated_at-1',
};

export const usersFixture: Users = {
  active: true,
  created_at: 'created_at-1',
  display_name: 'display_name-1',
  email: 'email-1',
  id: 'users-1',
  organization_id: 'organization_id-1',
  password_hash: 'password_hash-1',
  role: 'role-1',
};
