import { defineConfig, devices } from '@playwright/test';

const base = process.env.TEST_URL ?? 'http://localhost:4173/carol-of-the-bells-piano/';
const chromeArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=document-user-activation-required'];

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: { baseURL: base, launchOptions: { args: chromeArgs } },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 760 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], launchOptions: { args: chromeArgs } } },
  ],
  webServer: process.env.TEST_URL ? undefined : {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/carol-of-the-bells-piano/',
    reuseExistingServer: true,
  },
});
