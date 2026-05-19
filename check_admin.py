import sqlite3

db_path = 'instance/database.db'
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

print('=== CHECKING ADMIN USERS IN DATABASE ===\n')
cursor.execute('SELECT id, username, name, role, is_active, created_at FROM users WHERE role = ?', ('admin',))
admins = cursor.fetchall()

if admins:
    print(f'Found {len(admins)} admin(s):\n')
    for admin in admins:
        print(f'ID: {admin[0]}')
        print(f'Username: {admin[1]}')
        print(f'Name: {admin[2]}')
        print(f'Role: {admin[3]}')
        print(f'Active: {admin[4]}')
        print(f'Created: {admin[5]}')
        print('-' * 40)
else:
    print('No admin users found in database.')

print('\n=== ALL USERS IN DATABASE ===')
cursor.execute('SELECT id, username, name, role, is_active FROM users')
all_users = cursor.fetchall()
if all_users:
    print(f'Total users: {len(all_users)}\n')
    for user in all_users:
        print(f'ID: {user[0]}, Username: {user[1]}, Name: {user[2]}, Role: {user[3]}, Active: {user[4]}')
else:
    print('No users found.')

conn.close()

