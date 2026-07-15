# Conversation UI rules

- Keep data/mutations in feature hooks and access the bridge through the single
  validated client. App code imports each feature only through its public index.
- Drive components by roles, labels, keyboard actions, and visible text. Keep
  shareable selection in validated URL state and never render upstream HTML.
