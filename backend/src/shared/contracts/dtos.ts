// AUTO-GENERATED — do not edit by hand

export interface DeleteApiQuestionsByIdResolveResponse {
  id?: string;
  resolved_sides?: string;
  status?: string;
}

export interface GetApiChannelsByIdMessagesResponse {
  items?: {
    attachments?: {
      file_id?: string;
      name?: string;
    }[];
    author?: {
      display_name?: string;
      id?: string;
    };
    body_html?: string;
    created_at?: string;
    edited_at?: string;
    id?: string;
    reference_id?: string;
  }[];
  next_cursor?: string;
}

export interface GetApiFileVersionsByIdPagesByPageResponse {
  body?: string;
  content_type?: string;
}

export interface GetApiFilesByIdVersionsResponse {
  items?: {
    id?: string;
    size_bytes?: string;
    uploaded_at?: string;
    uploaded_by?: string;
    version_number?: number;
  }[];
}

export interface GetApiProjectsResponse {
  items?: {
    id?: string;
    name?: string;
    organization?: {
      id?: string;
      name?: string;
      type?: string;
    };
    status?: string;
  }[];
  page?: number;
  total?: number;
}

export interface GetApiProjectsByIdResponse {
  id?: string;
  members?: {
    display_name?: string;
    id?: string;
    role?: string;
  }[];
  name?: string;
  organization?: {
    id?: string;
    name?: string;
    type?: string;
  };
  status?: string;
}

export interface GetApiProjectsByIdChannelsResponse {
  general?: {
    id?: string;
    internal_only?: boolean;
    name?: string;
    unread_count?: number;
  }[];
  questions?: {
    id?: string;
    name?: string;
    status?: string;
    unread_count?: number;
  }[];
}

export interface GetApiProjectsByIdFilesResponse {
  files?: {
    id?: string;
    mime_type?: string;
    name?: string;
    size_bytes?: string;
    uploaded_at?: string;
    uploaded_by?: string;
    version_number?: number;
  }[];
  folder?: {
    breadcrumbs?: {
      id?: string;
      name?: string;
    }[];
    id?: string;
    name?: string;
  };
  folders?: {
    id?: string;
    name?: string;
  }[];
}

export interface GetApiProjectsByIdQuestionsResponse {
  items?: {
    id?: string;
    name?: string;
    resolved_sides?: string;
    status?: string;
    unread_count?: number;
  }[];
}

export interface GetApiProjectsByIdUnreadResponse {
  counts?: {
    channel_id?: string;
    unread_count?: number;
  }[];
}

export interface GetApiRealtimeSocketResponse {
  channel_id?: string;
  payload?: string;
  type?: string;
}

export interface GetApiReferencesByIdResponse {
  annotations?: string;
  author_id?: string;
  can_edit?: boolean;
  file_available?: boolean;
  file_version_id?: string;
  id?: string;
  message_id?: string;
  page_number?: number;
}

export interface GetApiUsersResponse {
  items?: {
    active?: boolean;
    created_at?: string;
    display_name?: string;
    email?: string;
    id?: string;
    organization_id?: string;
    role?: string;
  }[];
  page?: number;
  total?: number;
}

export interface PatchApiFilesByIdResponse {
  folder_id?: string;
  id?: string;
  name?: string;
}

export interface PatchApiFoldersByIdResponse {
  id?: string;
  name?: string;
  parent_id?: string;
}

export interface PatchApiMessagesByIdResponse {
  body_html?: string;
  edited_at?: string;
  id?: string;
}

export interface PatchApiProjectsByIdResponse {
  id?: string;
  name?: string;
  status?: string;
}

export interface PatchApiUsersByIdResponse {
  active?: boolean;
  display_name?: string;
  email?: string;
  id?: string;
  role?: string;
}

export interface PostApiChannelsByIdMessagesResponse {
  author_id?: string;
  body_html?: string;
  channel_id?: string;
  created_at?: string;
  id?: string;
}

export interface PostApiChannelsByIdReadResponse {
  channel_id?: string;
  last_read_message_id?: string;
  unread_count?: number;
}

export interface PostApiInvitationsByIdResendResponse {
  delivery?: string;
  expires_at?: string;
  id?: string;
  status?: string;
}

export interface PostApiMessagesByIdReferenceResponse {
  annotations?: string;
  author_id?: string;
  file_version_id?: string;
  id?: string;
  message_id?: string;
  page_number?: number;
}

export interface PostApiProjectsByIdArchiveResponse {
  id?: string;
  status?: string;
}

export interface PostApiProjectsByIdChannelsResponse {
  id?: string;
  internal_only?: boolean;
  kind?: string;
  name?: string;
  status?: string;
}

export interface PostApiProjectsByIdFoldersResponse {
  id?: string;
  name?: string;
  parent_id?: string;
}

export interface PostApiProjectsByIdInvitationsResponse {
  delivery?: string;
  email?: string;
  expires_at?: string;
  id?: string;
  project_id?: string;
  status?: string;
}

export interface PostApiProjectsByIdMembersResponse {
  added_at?: string;
  project_id?: string;
  user_id?: string;
}

export interface PostApiProjectsByIdQuestionsResponse {
  first_message_id?: string;
  id?: string;
  kind?: string;
  name?: string;
  status?: string;
}

export interface PostApiQuestionsByIdResolveResponse {
  id?: string;
  resolved_sides?: string;
  status?: string;
}

export interface PutApiReferencesByIdResponse {
  annotations?: string;
  id?: string;
  page_number?: number;
  updated_at?: string;
}
