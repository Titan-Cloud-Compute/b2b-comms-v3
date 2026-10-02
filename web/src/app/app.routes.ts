import { Routes } from '@angular/router';
import { FEATURE_ROUTES } from './features/index';
import { AUTHENTICATION_AND_ROLES_PUBLIC_ROUTES } from './features/authentication-and-roles/authentication-and-roles.routes';
import { authGuard, authChildGuard } from './shared/auth.guard';

export const routes: Routes = [
  {
    // Signed-in home; the guard bounces anonymous visitors to /login.
    path: '',
    redirectTo: 'projects',
    pathMatch: 'full'
  },
  // Public story routes (e.g. /accept-invite/:token) — no session required.
  ...AUTHENTICATION_AND_ROLES_PUBLIC_ROUTES,
  {
    path: 'login',
    loadComponent: () => import('./login/login.component').then(m => m.LoginComponent),
    data: { hideSupportFooter: true }
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
    // All session-only routes render inside the layout shell (sidebar + main area).
    // Feature routes (FEATURE_ROUTES from stories) are spread first so new pages
    // automatically inherit the shell without touching this file.
    path: '',
    loadComponent: () => import('./shared/layout.component').then(m => m.LayoutComponent),
    data: { rendersSupportFooterInLayout: true },
    canActivate: [authGuard],
    canActivateChild: [authChildGuard],
    children: [
      ...FEATURE_ROUTES,
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
        loadComponent: () => import('./admin/admin.component').then(m => m.AdminComponent)
      },
      {
        path: 'admin/overview',
        loadComponent: () => import('./admin/admin.component').then(m => m.AdminComponent)
      },
      {
        path: 'admin/users',
        loadComponent: () => import('./admin/admin.component').then(m => m.AdminComponent)
      },
      {
        path: 'admin/app-settings',
        loadComponent: () => import('./admin/admin.component').then(m => m.AdminComponent)
      },
    ]
  },
  {
    path: '**',
    redirectTo: 'login'
  }
];
