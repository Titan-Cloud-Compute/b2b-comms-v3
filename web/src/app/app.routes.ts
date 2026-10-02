import { Route, Routes } from '@angular/router';
import { FEATURE_ROUTES } from './features/index';
import { authGuard, rootRedirectGuard } from './shared/auth.guard';

/** Feature routes that must stay reachable while signed out. */
const PUBLIC_FEATURE_PATHS = ['login', 'accept-invite'];

/** Every feature route is guarded unless it is explicitly public. */
function guardFeature(route: Route): Route {
  const path = route.path ?? '';
  if (PUBLIC_FEATURE_PATHS.some(p => path === p || path.startsWith(p + '/'))) return route;
  if (route.redirectTo !== undefined) return route;
  return { ...route, canActivate: [authGuard, ...(route.canActivate ?? [])] };
}

export const routes: Routes = [
  ...FEATURE_ROUTES.map(guardFeature),
  {
    path: '',
    canActivate: [rootRedirectGuard],
    loadComponent: () => import('./landing/landing.component').then(m => m.LandingComponent),
    pathMatch: 'full'
  },
  {
    path: 'accept-invite/:token',
    loadComponent: () => import('./accept-invite/accept-invite.component').then(m => m.AcceptInviteComponent),
    data: { hideSupportFooter: true }
  },
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
