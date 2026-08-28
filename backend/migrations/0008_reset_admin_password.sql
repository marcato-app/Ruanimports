-- One-time reset of the admin password (username 'ruan') and clearing of any
-- accumulated login lockout, run through the normal deploy pipeline since
-- that's the only path with access to the real production D1 database.
UPDATE admin_users SET password_hash = 'b37d982f9dcbb8b7f2c7838634a27d78:5d76759e0ae4b795796d2dd4468ccb6496aacdd0b06eabd7391bd5814d4a9c5e' WHERE username = 'ruan';
DELETE FROM login_attempts WHERE username = 'ruan';
