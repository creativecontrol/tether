const functions = require('firebase-functions');

/*
  Twilio NTS
*/
exports.getICEConfig = functions.https.onCall(() => {

  const accountSid = functions.config().twilio.sid;
  const authToken = functions.config().twilio.token;
  const client = require('twilio')(accountSid, authToken);

  console.log(accountSid);
  console.log(authToken);

  return client.tokens.create().then((token) => {

    console.log(token);
    return {iceServers: token.iceServers};
  });
})
