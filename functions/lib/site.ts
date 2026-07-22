// The canonical public address of the app. Every link that goes into an email
// uses this, so invites, password resets, and notifications always point at
// mhdunnproperty.net regardless of which host the request happened to arrive on
// (for example dunns-rental.pages.dev). Google OAuth redirects are the one
// exception: they must use the live request origin and are left untouched.
export const SITE_URL = 'https://mhdunnproperty.net';
