// Test-only lost real PostgreSQL COMMIT acknowledgment in the actual CLI.
import {Client} from 'pg';
if(process.env.ODDPATH_ACTIVATION_TESTS!=='1')throw Error('TEST_ONLY');
const original=Client.prototype.query;let lost=false;
Client.prototype.query=function(sql,...args){const value=original.call(this,sql,...args);
 if(!lost&&this.database==='postgres'&&sql==='COMMIT'){lost=true;return value.then(()=>{this.connection.stream.destroy();throw Error('LOST_ACTIVATION_COMMIT_ACK');});}
 return value;
};
