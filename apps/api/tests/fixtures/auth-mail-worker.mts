import nodemailer from 'nodemailer';
import {assertPostgresIntegrationTarget} from '../helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
const {prisma}=await import('../../src/db/prisma.ts');
const {createAuthEmailOutboxWorker}=await import('../../src/modules/auth/auth-email-outbox.worker.ts');
const {SmtpAuthEmailService}=await import('../../src/modules/auth/auth.email.ts');
const input=JSON.parse(process.argv[2]!);
if(input.host!=='127.0.0.1')throw Error('SMTP fixture must use loopback');
// Plain local fixture only. Production createSmtpTransporter still requires TLS.
const transport=nodemailer.createTransport({host:input.host,port:input.port,secure:false,ignoreTLS:true});
try {
 const summary=await createAuthEmailOutboxWorker({batchSize:10,now:()=>new Date(input.time),emailService:new SmtpAuthEmailService({from:'fixture@example.test',transporter:transport})}).runOnce();
 console.log(JSON.stringify({event:'fixture_outbox',...summary}));
}finally{transport.close();await prisma.$disconnect();}
