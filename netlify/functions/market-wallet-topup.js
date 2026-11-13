const { json, parseBody } = require("./_market-auth");
const { getMarketUser } = require("./_market-data");
const DATEVAULT_PRINTPAY = "https://elysiandate.site/.netlify/functions/printpay";
const PACKS = {100:1,500:5,1000:10,2000:20,5000:50,10000:90};
async function providerRequest(url,options){const response=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||data.message||"Payment service is temporarily unavailable.");return data;}
exports.handler=async event=>{
 if(!["GET","POST"].includes(event.httpMethod))return json(405,{error:"POST or GET required."},{Allow:"GET, POST"});
 try{
  const session=getMarketUser(event);if(session.error)return session.error;
  const admin=require("firebase-admin");if(!admin.apps.length)admin.initializeApp({credential:admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))});
  const db=admin.firestore(),userRef=db.collection("users").doc(session.uid),userSnap=await userRef.get();
  if(!userSnap.exists)return json(403,{error:"Market account not found."});
  const user=userSnap.data()||{};
  if(user.banned||user.suspended||user.accountSuspended||user.marketBanned||user.walletFrozen)return json(403,{error:"Your account or shared wallet is restricted."});
  if(event.httpMethod==="POST"){
   const body=parseBody(event),tokens=Number(body.tokens),phone=String(body.phone||"").replace(/[^0-9]/g,"");
   if(!Number.isSafeInteger(tokens)||tokens<30||tokens>1000000)return json(400,{error:"Enter at least 30 whole tokens."});
   if(!/^254[17]\d{8}$/.test(phone)&&!/^0[17]\d{8}$/.test(phone))return json(400,{error:"Enter a valid Kenyan M-Pesa number."});
   const amountUSD=PACKS[tokens]??Number((tokens/100).toFixed(2)),amountKes=Math.round(amountUSD*130);
   const data=await providerRequest(DATEVAULT_PRINTPAY,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({phone_number:phone,amount:amountKes,uid:session.uid,purpose:"tokens",tokens,amountUSD})});
   if(!data.checkout_id)return json(502,{error:"Payment provider did not return a checkout reference."});
   return json(200,{ok:true,checkoutId:String(data.checkout_id),tokens,amountUSD,amountKes});
  }
  const checkoutId=String(event.queryStringParameters?.checkout_id||"");
  if(!/^[A-Za-z0-9_-]{4,160}$/.test(checkoutId))return json(400,{error:"A valid checkout reference is required."});
  const paymentRef=db.collection("payments").doc("printpay_"+checkoutId),paymentSnap=await paymentRef.get();
  if(!paymentSnap.exists||paymentSnap.data().uid!==session.uid||paymentSnap.data().purpose!=="tokens")return json(404,{error:"This top-up could not be found for your Market account."});
  const data=await providerRequest(DATEVAULT_PRINTPAY+"?checkout_id="+encodeURIComponent(checkoutId),{method:"GET",headers:{Accept:"application/json"}});
  const fresh=await paymentRef.get(),wallet=await userRef.get();
  return json(200,{ok:true,status:data.status||(data.completed?"SUCCESS":"PENDING"),completed:data.completed===true||(fresh.data()||{}).status==="completed",failed:data.failed===true,walletBalance:Number((wallet.data()||{}).walletBalance||0)});
 }catch(error){console.error("Market wallet top-up failed:",error.message);return json(502,{error:error.message||"Could not process this top-up."});}
};
