import { Routes } from '@angular/router';
import { FEATURE_ROUTES } from './features/index';
import { adminGuard, authGuard, rootRedirectGuard } from './shared/auth.guard';

/** Feature routes are authenticated unless they opt out with data.public. */
const GUARDED_FEATURE_ROUTES: Routes = FEATURE_ROUTES.map(r =>
  r.data?.['public'] || r.redirectTo !== undefined
    ? r
    : { ...r, canActivate: [...(r.canActivate ?? []), authGuard] },
);

export const routes: Routes = [
  ...GUARDED_FEATURE_ROUTES,
  {
    // '/' redirects by session: signed in → projects home, otherwise → /login.
    path: '',
    pathMatch: 'full',
    canActivate: [rootRedirectGuard],
    children: []
  },
  {
    path: 'login',
    loadComponent: () => import('./login/login.component').then(m => m.LoginComponent),
    data: { hideSupportFooter: true }
  },
  {
    // Public invitation landing: the token is redeemed via POST /api/invitations/accept.
    path: 'accept-invite/:token',
    loadComponent: () => import('./login/login.component').then(m => m.LoginComponent),
    data: { hideSupportFooter: true, public: true }
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./forgot-password/forgot-password.component').then(m => m.ForgotPasswordComponent),
    data: { hideSupportFooter: true }
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./reset-password/reset-password.component').then(m => m.ResetPasswordComponent),
    data: { hideSupportFooter: true }
  },
  {
    path: 'signup',
    redirectTo: 'signup/1',
    pathMatch: 'full'
  },
  {
    path: 'signup/:step',
    loadComponent: () => import('./signup/signup.component').then(m => m.SignupComponent),
    data: { hideSupportFooter: ['1'] }
  },
  {
    path: 'terms',
    loadComponent: () => import('./terms/terms.component').then(m => m.TermsComponent)
  },
  {
    path: 'privacy',
    loadComponent: () => import('./privacy/privacy.component').then(m => m.PrivacyComponent)
  },
  {
    path: 'about',
    loadComponent: () => import('./about/about.component').then(m => m.AboutComponent),
    data: { hideSupportFooter: true }
  },
  {
    path: '',
    loadComponent: () => import('./shared/layout.component').then(m => m.LayoutComponent),
    data: { rendersSupportFooterInLayout: true },
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent)
      },
      {
        path: 'settings',
        loadComponent: () => import('./settings/settings.component').then(m => m.SettingsComponent)
      },
      {
        path: 'admin',
        loadComponent: () => import('./admin/admin.component').then(m => m.AdminComponent),
        canActivate: [adminGuard]
      },
      {
        path: 'admin/overview',
        loadComponent: () => import('./admin/admin.component').then(m => m.AdminComponent),
        canActivate: [adminGuard]
      },
      {
        path: 'admin/users',
        loadComponent: () => import('./admin/admin.component').then(m => m.AdminComponent),
        canActivate: [adminGuard]
      },
      {
        path: 'admin/app-settings',
        loadComponent: () => import('./admin/admin.component').then(m => m.AdminComponent),
        canActivate: [adminGuard]
      },
    ]
  },
  {
    path: '**',
    redirectTo: 'login'
  }
];
