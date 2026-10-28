export const CANONICAL_ENTITY_TYPES = ['ranking', 'coordination', 'user', 'sync', 'authentication', 'app_navigation', 'ticket'] as const;
export type CanonicalEntityType = (typeof CANONICAL_ENTITY_TYPES)[number];

export const CANONICAL_ACTIONS = [
  // ranking (incluye el cierre automÃ¡tico preexistente y aprobado)
  'ranking_reorder', 'ranking_position_change', 'ranking_remove', 'ranking_auto_deactivate', 'ranking_remediation',
  // coordination
  'coordination_update',
  // user
  'user_create', 'user_update', 'user_activate', 'user_deactivate', 'user_role_change', 'user_scopes_change', 'user_referent_change',
  // sync (exclusivamente manual)
  'manual_sync_success', 'manual_sync_error',
  // authentication
  'login_success', 'login_failure', 'auth_unavailable', 'logout_success',
  // application activity
  'app_page_view', 'ticket_list_view', 'ticket_detail_view', 'glpi_ticket_open',
  // KPI Sistemas

] as const;
export type CanonicalAction = (typeof CANONICAL_ACTIONS)[number];
