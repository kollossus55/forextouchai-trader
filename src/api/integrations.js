import { base44 } from './base44Client';

// UploadFile and UploadPrivateFile remain client-side (allowed).
// All restricted Core integrations (InvokeLLM, SendEmail, GenerateImage,
// ExtractDataFromUploadedFile, etc.) have been moved to backend functions
// to protect integration credits.
export const UploadFile = base44.integrations.Core.UploadFile;