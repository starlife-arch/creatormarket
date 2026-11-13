const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
test("buyer age assurance is a one-time date-of-birth check with no document upload or Didit fee",()=>{
 const source=fs.readFileSync(path.join(root,"netlify/functions/market-age-verification.js"),"utf8");
 assert.match(source,/verify-dob/);assert.match(source,/marketAgeVerified:true/);
 assert.match(source,/date_of_birth_attestation/);
 assert.doesNotMatch(source,/didit-session|marketAgeVerificationCharges|walletBalance.*50|cloudinary/i);
 const html=fs.readFileSync(path.join(root,"verify-age.html"),"utf8");
 assert.match(html,/type="date"/);assert.doesNotMatch(html,/type="file"|Didit|50 tokens/i);
});
test("creator identity keeps free manual evidence and charges 50 tokens only for Didit",()=>{
 const source=fs.readFileSync(path.join(root,"netlify/functions/market-creator-identity-verification.js"),"utf8");
 assert.match(source,/action==="didit-session"/);assert.match(source,/balance<50/);
 assert.match(source,/amountTokens:50/);assert.match(source,/market_creator_identity_didit/);
 assert.match(source,/Your 50 tokens have been refunded/);
 assert.match(source,/["didit_starting","didit_in_progress"].includes\(current.status\)/);
 assert.match(source,/market_session_persistence_failed/);
 const html=fs.readFileSync(path.join(root,"verify-creator-identity.html"),"utf8");
 assert.match(html,/Free manual ID \+ selfie review/);assert.match(html,/Didit verification · 50 tokens/);
});
test("Didit webhook routes creator identity decisions separately from buyer age assurance",()=>{
 const source=fs.readFileSync(path.join(root,"netlify/functions/market-didit-webhook.js"),"utf8");
 assert.match(source,/mapping\.purpose==="creator_identity"/);
 assert.match(source,/marketCreatorIdentityVerified:approved/);
 assert.match(source,/marketAgeVerified:approved/);
});
test("Market wallet top-up uses Market session and shared DateVault PrintPay ledger",()=>{
 const source=fs.readFileSync(path.join(root,"netlify/functions/market-wallet-topup.js"),"utf8");
 assert.match(source,/getMarketUser\(event\)/);assert.match(source,/purpose:"tokens"/);
 assert.match(source,/payments/);assert.match(source,/walletFrozen/);
 const ui=fs.readFileSync(path.join(root,"assets/market-workspace.js"),"utf8");
 assert.match(ui,/\/api\/market-wallet-topup/);assert.match(ui,/Top up in Creator Market/);
 assert.doesNotMatch(ui,/openMarketWalletTopUp|market-wallet-sso-issue/);
});

test("new age, creator identity and top-up server functions parse",()=>{
 for(const file of ["netlify/functions/market-age-verification.js","netlify/functions/market-creator-identity-verification.js","netlify/functions/market-didit-webhook.js","netlify/functions/market-wallet-topup.js"]){
  const source=fs.readFileSync(path.join(root,file),"utf8");
  assert.doesNotThrow(()=>new (require("node:vm").Script)(source,{filename:file}));
 }
});
