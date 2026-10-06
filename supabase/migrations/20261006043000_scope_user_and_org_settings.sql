-- Keep account preferences and organization defaults in their existing
-- respective rows. Older versions stored some organization keys in user_settings
-- and some personal keys in organization_settings; remove only the known
-- duplicated keys while preserving all unknown settings.

UPDATE public.user_settings
SET settings = COALESCE(settings, '{}'::jsonb)
  - ARRAY[
      'defaultPort',
      'defaultCustomsOffice',
      'defaultWorkflow',
      'currency',
      'exchangeMode',
      'vatRate',
      'documentMaxMb',
      'retentionDays',
      'vesselAutoRefresh',
      'numberPrefix',
      'numberingPrefix',
      'numberingDigits',
      'numberingYear',
      'numberingMonth',
      'duplicateClients'
    ]::text[],
    updated_at = now()
WHERE settings IS NOT NULL;

UPDATE public.organization_settings
SET settings = COALESCE(settings, '{}'::jsonb)
  - ARRAY[
      'theme',
      'density',
      'comfort',
      'sidebarCollapsed',
      'calendar',
      'timezone',
      'reminderEnabled',
      'desktopNotifications',
      'sessionMinutes',
      'chat',
      'fontSize',
      'animations',
      'reducedMotion',
      'stickyHeader',
      'zebraRows',
      'hoverRows',
      'autoSave',
      'quietHours',
      'quietFrom',
      'quietTo'
    ]::text[],
    updated_at = now()
WHERE settings IS NOT NULL;
