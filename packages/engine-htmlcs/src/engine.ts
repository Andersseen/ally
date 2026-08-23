import { createRequire } from 'node:module';
import { installDomHelpers } from '@ally/browser/dom';
import type { AllyPage as Page } from '@ally/browser/page';
import type { AuditEngine, EngineOutput } from '@ally/core';
import { HTMLCS_ENGINE } from './metadata.js';
import { countHtmlCsMessages, normalizeHtmlCsResults } from './normalize.js';
import type { HtmlCsRawOutput } from './normalize.js';

const require = createRequire(import.meta.url);
const htmlCsSourcePath = require.resolve('html_codesniffer/build/HTMLCS.js');
const htmlCsPackage = require('html_codesniffer/package.json') as { readonly version?: string };

export function createHtmlCsEngine(): AuditEngine<Page, HtmlCsRawOutput> {
  return {
    id: HTMLCS_ENGINE.id,
    name: HTMLCS_ENGINE.name,
    homepage: HTMLCS_ENGINE.homepage,
    license: HTMLCS_ENGINE.license,
    ...(htmlCsPackage.version === undefined ? {} : { version: htmlCsPackage.version }),

    async run({ page }): Promise<EngineOutput<HtmlCsRawOutput>> {
      await installDomHelpers(page);
      await page.addScriptTag({ path: htmlCsSourcePath });

      const raw = await page.evaluate(() => {
        return new Promise<HtmlCsRawOutput>((resolve, reject) => {
          const global = window as unknown as {
            HTMLCS?: {
              getMessages(): readonly {
                type: number;
                msg: string;
                code: string;
                element?: Element;
              }[];
              process(
                standard: string,
                content: Element,
                callback: () => void,
                failCallback?: () => void,
                language?: string,
              ): void;
            };
            __allyDom?: {
              describe(element: Element): {
                path: string;
                tagName: string;
                label: string;
                html: string;
              };
            };
          };

          const htmlcs = global.HTMLCS;
          if (htmlcs === undefined) {
            reject(new Error('HTML_CodeSniffer did not install a global HTMLCS object.'));
            return;
          }

          htmlcs.process(
            'WCAG2AA',
            document.documentElement,
            () => {
              resolve({
                standard: 'WCAG2AA',
                messages: htmlcs.getMessages().map((message) => {
                  const target =
                    message.element === undefined
                      ? undefined
                      : global.__allyDom?.describe(message.element);
                  return {
                    type: message.type,
                    typeName:
                      message.type === 1
                        ? 'error'
                        : message.type === 2
                          ? 'warning'
                          : message.type === 3
                            ? 'notice'
                            : 'unknown',
                    message: message.msg,
                    code: message.code,
                    ...(target === undefined
                      ? {}
                      : {
                          target: {
                            path: target.path,
                            html: target.html,
                            label: target.label,
                            tagName: target.tagName,
                          },
                        }),
                  };
                }),
              });
            },
            () => reject(new Error('HTML_CodeSniffer failed to load the WCAG2AA standard.')),
            'en',
          );
        });
      });

      return {
        raw,
        rawCount: countHtmlCsMessages(raw),
        ...(htmlCsPackage.version === undefined ? {} : { version: htmlCsPackage.version }),
      };
    },

    normalize: normalizeHtmlCsResults,
  };
}
