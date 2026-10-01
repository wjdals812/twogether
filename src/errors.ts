const MESSAGES: Record<string, string> = {
  // Supabase Auth error codes
  invalid_credentials: '이메일 또는 비밀번호가 올바르지 않습니다.',
  user_already_exists: '이미 가입된 이메일입니다.',
  email_exists: '이미 가입된 이메일입니다.',
  weak_password: '비밀번호가 너무 약합니다. 6자 이상으로 입력해 주세요.',
  email_address_invalid: '사용할 수 없는 이메일 주소입니다.',
  validation_failed: '입력한 내용을 확인해 주세요.',
  email_not_confirmed: '이메일 인증이 아직 끝나지 않았습니다.',
  signup_disabled: '지금은 회원가입을 받지 않습니다.',
  over_request_rate_limit: '요청이 너무 많습니다. 잠시 뒤에 다시 시도해 주세요.',
  over_email_send_rate_limit: '이메일을 너무 자주 보냈습니다. 잠시 뒤에 다시 시도해 주세요.',
  23514: '방 이름은 1~20자로 입력해 주세요.', // check violation (room name length)
  // messages raised by the SQL functions in schema.sql
  'not logged in': '로그인이 필요합니다.',
  'already in this room': '이미 들어가 있는 방입니다.',
  'not a member': '이 방의 멤버가 아닙니다.',
  'invalid invite code': '초대 코드가 올바르지 않습니다.',
  'room is full': '방이 가득 찼습니다. (최대 4명)',
}

// Falls back to a generic Korean message so no English error reaches the screen.
export const koError = (e: { code?: string; message: string }) =>
  MESSAGES[e.code ?? ''] ?? MESSAGES[e.message] ?? '문제가 생겼습니다. 잠시 뒤에 다시 시도해 주세요.'
