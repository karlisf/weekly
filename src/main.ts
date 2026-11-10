import { mount } from 'svelte';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import './app.css';
import App from './App.svelte';
import { app } from './lib/store.svelte';

const target = document.getElementById('app')!;
mount(App, { target });
void app.start();
