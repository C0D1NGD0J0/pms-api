import { PropertyController } from '@controllers/PropertyController';
import { withoutPendingUploads } from '@services/property/propertyHelpers';

describe('withoutPendingUploads', () => {
  it('drops entries that only describe a file still being uploaded', () => {
    const media = [
      { url: 'https://s3/doc-1.pdf', documentType: 'deed' },
      { documentType: 'proof_of_ownership' }, // file part, no url yet
      { externalUrl: 'https://example.com/plan.pdf' },
      {},
    ];

    expect(withoutPendingUploads(media)).toEqual([
      { url: 'https://s3/doc-1.pdf', documentType: 'deed' },
      { externalUrl: 'https://example.com/plan.pdf' },
    ]);
  });
});

describe('PropertyController document type mapping', () => {
  const controller = new PropertyController({
    propertyService: {} as any,
    mediaUploadService: {} as any,
  });
  const applyDocumentTypes = (req: any) => (controller as any).applyDocumentTypesToUploads(req);

  it('copies each documentType onto the upload with the same documents[i] index', () => {
    const req = {
      body: { documents: [{ documentType: 'proof_of_ownership' }, {}, { documentType: 'deed' }] },
      scannedFiles: [
        { fieldName: 'documents[2].file', filename: 'deed.pdf' },
        { fieldName: 'documents[0].file', filename: 'ownership.pdf' },
        { fieldName: 'documents[1].file', filename: 'untyped.pdf' },
        { fieldName: 'images[0].file', filename: 'front.jpg' },
      ],
    };

    applyDocumentTypes(req);

    expect(req.scannedFiles.map((file: any) => file.documentType)).toEqual([
      'deed',
      'proof_of_ownership',
      undefined,
      undefined,
    ]);
  });

  it('does nothing when there are no uploads or no document metadata', () => {
    const noFiles = { body: { documents: [{ documentType: 'deed' }] } };
    const noDocuments = { body: {}, scannedFiles: [{ fieldName: 'documents[0].file' }] };

    expect(() => applyDocumentTypes(noFiles)).not.toThrow();
    applyDocumentTypes(noDocuments);
    expect((noDocuments.scannedFiles[0] as any).documentType).toBeUndefined();
  });
});
