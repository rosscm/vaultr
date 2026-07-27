import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const docsDir = join(root, 'docs');
const htmlFiles = ['index.html', 'privacy.html', 'terms.html', '404.html'];
const requiredFiles = [
  ...htmlFiles,
  'styles.css',
  'site.js',
  'robots.txt',
  'sitemap.xml',
  '_headers',
  'assets/favicon.svg',
  'assets/social-preview.svg'
];

const failures: string[] = [];
const warnings: string[] = [];

function read(relativePath: string): string {
  return readFileSync(join(docsDir, relativePath), 'utf8');
}

for (const file of requiredFiles) {
  if (!existsSync(join(docsDir, file))) failures.push(`Missing docs/${file}`);
}

const css = existsSync(join(docsDir, 'styles.css')) ? read('styles.css') : '';
const definedClasses = new Set([...css.matchAll(/\.([a-zA-Z0-9_-]+)(?=[\s.#:{,[)>])/g)].map((match) => match[1]));

for (const file of htmlFiles) {
  if (!existsSync(join(docsDir, file))) continue;
  const html = read(file);
  const classNames = [...html.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/));
  for (const className of classNames) {
    if (!definedClasses.has(className)) failures.push(`docs/${file} uses undefined CSS class .${className}`);
  }

  if (/<script(?![^>]+src=)[^>]*>/i.test(html)) failures.push(`docs/${file} contains an inline script`);
  if (/<style[\s>]/i.test(html)) failures.push(`docs/${file} contains an inline style block`);

  const blankLinks = [...html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/gi)];
  for (const [link] of blankLinks) {
    if (!/rel="[^"]*\bnoopener\b[^"]*\bnoreferrer\b[^"]*"/i.test(link)) {
      failures.push(`docs/${file} has target="_blank" without rel="noopener noreferrer"`);
    }
  }

  if (!/<title>[^<]+<\/title>/i.test(html)) failures.push(`docs/${file} is missing a title`);
  if (!/<meta\s+name="description"/i.test(html) && file !== '404.html') failures.push(`docs/${file} is missing a meta description`);
  if (!/<link\s+rel="icon"/i.test(html)) failures.push(`docs/${file} is missing a favicon link`);
}

const headers = existsSync(join(docsDir, '_headers')) ? read('_headers') : '';
for (const header of ['Content-Security-Policy', 'Referrer-Policy', 'Permissions-Policy', 'X-Content-Type-Options']) {
  if (!headers.includes(header)) failures.push(`docs/_headers is missing ${header}`);
}

const domainFiles = ['index.html', 'privacy.html', 'terms.html', 'robots.txt', 'sitemap.xml'];
for (const file of domainFiles) {
  if (existsSync(join(docsDir, file)) && read(file).includes('vaultr.example')) {
    warnings.push(`docs/${file} still uses the explicit placeholder domain vaultr.example`);
  }
}

if (warnings.length > 0) {
  console.warn('Static site warnings:');
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (failures.length > 0) {
  console.error('Static site validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Static site validation passed.');
