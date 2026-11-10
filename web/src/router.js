import { createRouter, createWebHistory } from 'vue-router';
import axios from 'axios';

const Home = () => import('./views/Home.vue');
const Admin = () => import('./views/Admin.vue');

const routes = [
  { path: '/', component: Home, meta: { requiresAuth: true } },
  { path: '/admin', component: Admin }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

let sessionCheck = null;

async function hasValidSession() {
  if (!sessionCheck) {
    sessionCheck = axios.get('/api/users/me', { withCredentials: true })
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        sessionCheck = null;
      });
  }
  return sessionCheck;
}

router.beforeEach(async to => {
  if (!to.matched.some(route => route.meta.requiresAuth)) return true;
  if (await hasValidSession()) return true;
  return { path: '/admin', query: { redirect: to.fullPath } };
});

export default router;
