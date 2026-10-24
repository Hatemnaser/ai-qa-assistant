import {toQaReportRequest} from '../../src/modules/qa-requests/qa-report.mapper.ts';
import {createQaProvenance} from '../../src/modules/qa-requests/qa-evidence-provenance.ts';
import type {QaHistory} from '../../src/modules/qa-requests/qa-report.types.ts';
export const QA_REPORT_NOW=new Date('2026-10-14T12:00:00.000Z');
export function qaReportRaw(){
 const provenance=createQaProvenance({actor:{kind:'INTEGRATION',transport:'REST'},projectId:'project-1',requestId:'request-1',runId:'run-1',artifactId:'artifact-1',item:{id:'item-1',expectedResult:'Heading visible'},target:'https://example.test',environment:'STAGING',commitSha:'build-1',recordedAt:QA_REPORT_NOW});
 return {id:'request-1',projectId:'project-1',title:'Heading',objective:'Check heading',phase:'APPROVED',target:'https://example.test/?signed=private#login',environment:'STAGING',createdAt:QA_REPORT_NOW,
  artifacts:[{id:'artifact-1',revision:1,origin:'AGENT_PROVIDED',title:'Checklist',createdAt:QA_REPORT_NOW,items:[{id:'item-1',ordinal:0,title:'Heading',preconditions:[],steps:['Open home'],expectedResult:'Heading visible',evidenceRequirements:[{id:'requirement-1',kind:'TEXT',description:'Heading receipt',required:true}]}],assessments:[{status:'PASSED',summary:'AI interpretation only',provider:'fixture',model:'fixture',createdAt:QA_REPORT_NOW}]}],
  executionRecipes:[],runs:[{id:'run-1',artifactId:'artifact-1',status:'RESULTS_SUBMITTED',outcome:'PASS',commitSha:'build-1',startedAt:QA_REPORT_NOW,submittedAt:QA_REPORT_NOW,
   executionJob:{id:'job-1',status:'SUCCEEDED',recipeHash:'a'.repeat(64),executorKey:'playwright',leaseTokenHash:'DO_NOT_EXPORT',claimId:'DO_NOT_EXPORT'},
   results:[{id:'result-1',checklistItemId:'item-1',status:'PASS',observedResult:'Heading seen',notes:null,provenance}],evidence:[{id:'evidence-1',checklistItemId:'item-1',requirementId:'requirement-1',kind:'TEXT',textContent:'Heading seen',externalReference:null,metadata:{password:'DO_NOT_EXPORT'},actorKind:'INTEGRATION',transport:'REST',createdAt:QA_REPORT_NOW,provenance,assets:[]}]}],
  reviews:[{id:'review-1',runId:'run-1',decision:'APPROVED',comment:'Historical review',createdAt:QA_REPORT_NOW}],events:[],contextSnapshots:[{version:1,payloadHash:'b'.repeat(64),payload:{secret:'DO_NOT_EXPORT'}}],
  authorization:{token:'DO_NOT_EXPORT'},storageState:{cookies:['DO_NOT_EXPORT']},
 };
}
export function qaHistory():QaHistory{return {schemaVersion:1,exportType:'QA_HISTORY',historicalOnly:true,projectId:'project-1',exportedAt:QA_REPORT_NOW.toISOString(),requests:[toQaReportRequest(qaReportRaw(),QA_REPORT_NOW)]};}
