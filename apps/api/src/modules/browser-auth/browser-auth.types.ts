import type { QaActor } from '../qa-requests/qa-requests.types.js';
export interface SavedLoginMetadata { id:string;revision:number;targetRevisionId:string;targetHash:string;createdAt:string;expiresAt:string;revoked:boolean;targetLabel:string|null;targetUrl:string|null }
export interface BrowserAuthRepository {
  list(ownerId:string,projectId:string):Promise<SavedLoginMetadata[]>;
  revoke(ownerId:string,projectId:string,id:string,actor?:QaActor):Promise<{revoked:true;stopConfirmed:boolean}>;
  cleanupExpired():Promise<number>;
  revokeOwner(ownerId:string,projectId?:string):Promise<void>;
}
