import { DEMO_MODE } from '../config.js';
import { demoStore } from './demoStore.js';
import { supabaseStore } from './supabaseStore.js';

export const store = DEMO_MODE ? demoStore : supabaseStore;
