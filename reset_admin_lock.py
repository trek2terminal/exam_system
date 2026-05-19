import sqlite3

db_path = 'instance/database.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print('=== RESETTING ADMIN ACCOUNT LOCK ===\n')

# Get current admin status
cursor.execute('''
    SELECT id, username, failed_login_attempts, locked_until 
    FROM users WHERE role = ? 
''', ('admin',))
admin = cursor.fetchone()

if admin:
    admin_id, username, failed_attempts, locked_until = admin
    print(f'Admin Found: {username}')
    print(f'Failed Attempts: {failed_attempts}')
    print(f'Locked Until: {locked_until}')
    print()

    # Reset failed attempts and lock
    cursor.execute('''
        UPDATE users 
        SET failed_login_attempts = 0, locked_until = NULL 
        WHERE id = ?
    ''', (admin_id,))

    conn.commit()
    print(f'✓ Admin account lock has been reset!')
    print(f'Failed Attempts: 0')
    print(f'Locked Until: NULL')
    print(f'\nYou can now login again.')
else:
    print('No admin user found in database.')

conn.close()

