# SSO setup

**Управление → Система → Настройки → Вход через SSO.** Any OAuth2 *authorization code* provider works (Keycloak, Authentik, Okta, Google, GitLab, …).

1. At the provider, register an application with redirect URI `APP_URL/auth/callback` (the form displays the exact value).
2. Fill in: authorize URL, token URL, userinfo URL, client id/secret, scope.
3. Map profile fields by dot-path (e.g. `email`, `name`, `sub`, `data.user.email`) and choose the default role for new users.
4. Switch it on. The button appears on the login page; password login stays available.

Users are matched by the provider's subject id, then by e-mail. The e-mail in `ADMIN_EMAIL` always gets the admin role.
