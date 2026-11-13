const { json, parseBody, originAllowed } = require("./_market-auth");
const { loadMarketUser, cleanText } = require("./_market-data");
function isAdult(value) {
  if (typeof value !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const dob = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(dob.getTime()) || dob.toISOString().slice(0,10) !== value || dob.getTime() > Date.now()) return false;
  const now = new Date(); let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const month = now.getUTCMonth() - dob.getUTCMonth();
  if (month < 0 || (month === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age >= 18;
}
exports.handler = async event => {
  if (!["GET","POST"].includes(event.httpMethod)) return json(405,{error:"Method not allowed."},{Allow:"GET, POST"});
  try {
    if (event.httpMethod === "POST" && !originAllowed(event)) return json(403,{error:"Request origin is not allowed."});
    const context = await loadMarketUser(event); if (context.error) return context.error;
    const userRef = context.admin.firestore().collection("users").doc(context.uid), profile = context.profile || {};
    if (profile.marketAgeVerified === true && profile.verificationStatus !== "reverification_requested")
      return json(200,{verified:true,status:"verified",reused:true,message:"Your one-time 18+ age check is already complete."});
    if (event.httpMethod === "GET") return json(200,{verified:false,status:"not_verified",message:"Enter your date of birth to confirm you are 18 or older. This one-time buyer check does not require an ID or selfie."});
    const body=parseBody(event);
    if (cleanText(body.action,32)!=="verify-dob") return json(400,{error:"Unsupported age-verification action."});
    if (!isAdult(body.dateOfBirth)) return json(403,{error:"You must be at least 18 years old to use restricted Creator Market features."});
    const admin=context.admin;
    await admin.firestore().runTransaction(async tx=>{
      const fresh=await tx.get(userRef); if(!fresh.exists) throw new Error("ACCOUNT_UNAVAILABLE");
      const current=fresh.data()||{};
      if(current.marketAgeVerified===true && current.verificationStatus!=="reverification_requested") return;
      if(current.banned||current.suspended||current.accountSuspended||current.marketBanned) throw new Error("ACCOUNT_RESTRICTED");
      tx.update(userRef,{marketAgeVerified:true,marketAgeVerifiedAt:admin.firestore.FieldValue.serverTimestamp(),
        marketAgeVerificationMethod:"date_of_birth_attestation",marketAgeVerificationProvider:null,marketAgeVerificationStatus:"Approved"});
      tx.create(admin.firestore().collection("marketAdminAudit").doc(),{actorUid:"buyer_age_attestation",
        action:"market_buyer_age_verified",targetUid:context.uid,
        reason:"Member confirmed date of birth as 18+; date of birth was not stored.",
        createdAt:admin.firestore.FieldValue.serverTimestamp()});
    });
    return json(200,{ok:true,verified:true,status:"verified",message:"Your 18+ age check is complete. You will not need to repeat it unless re-verification is required."});
  } catch(error) {
    if(error.message==="ACCOUNT_RESTRICTED") return json(403,{error:"This account is restricted from Creator Market."});
    console.error("Market buyer age assurance failed:",error.message);
    return json(500,{error:"Unable to save your age confirmation. Please try again."});
  }
};
