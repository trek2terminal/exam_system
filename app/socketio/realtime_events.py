from flask_socketio import SocketIO, emit, join_room, leave_room
from flask import request, session
from app.services.security_service import SecurityService

socketio = SocketIO()

def init_socketio(app):
    socketio.init_app(app, cors_allowed_origins="*", async_mode='eventlet')


@socketio.on('connect')
def handle_connect():
    emit('message', {'data': 'Connected to realtime server'})


@socketio.on('join_exam')
def handle_join_exam(data):
    session_code = data.get('session_code')
    if session_code:
        join_room(session_code)
        emit('status', {'message': f'Joined exam room: {session_code}'}, room=session_code)


@socketio.on('heartbeat')
def handle_heartbeat(data):
    session_code = data.get('session_code')
    if session_code:
        SecurityService.record_heartbeat(
            session_code,
            focused=data.get('focused', True),
            violation_count=data.get('violation_count', 0)
        )
        emit('heartbeat_ack', {'status': 'ok'}, room=session_code)


@socketio.on('violation')
def handle_violation(data):
    session_code = data.get('session_code')
    if session_code:
        emit('proctor_alert', {
            'message': 'Violation detected',
            'type': data.get('type'),
            'count': data.get('count')
        }, room=session_code)