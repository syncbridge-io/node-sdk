import { ApiDocument, ApiDocumentFactory } from '@opra/common';
import { SbError } from './classes/sb-error.js';
import * as models from './models/index.js';

let doc: ApiDocument;

export async function initializeModelsDocument() {
  doc =
    doc ||
    (await ApiDocumentFactory.createDocument({
      types: [...Object.values(models)],
    }));
  return doc;
}

export function getModelsDocument(): ApiDocument {
  if (!doc)
    throw new SbError('You must call initializeModelsDocument() first', {
      severity: 'fatal',
    });
  return doc;
}
