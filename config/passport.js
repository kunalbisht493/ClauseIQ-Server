const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const User = require('../models/User.model');

function hasGoogleOAuthConfig() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL);
}

function configureGoogleOAuth() {
  if (!hasGoogleOAuthConfig()) return false;
  passport.use('google', new GoogleStrategy({ clientID: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, callbackURL: process.env.GOOGLE_CALLBACK_URL }, async (_accessToken, _refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.trim().toLowerCase();
      if (!email) return done(new Error('Google did not provide an email address'));
      let user = await User.findOne({ googleId: profile.id });
      if (!user) {
        user = await User.findOne({ email });
        if (user) {
          user.googleId = profile.id;
          user.emailVerified = true;
          await user.save();
        } else {
          user = await User.create({ name: profile.displayName || email.split('@')[0], email, googleId: profile.id, emailVerified: true });
        }
      }
      return done(null, user);
    } catch (error) { return done(error); }
  }));
  return true;
}

const googleOAuthEnabled = configureGoogleOAuth();
module.exports = { passport, googleOAuthEnabled };
