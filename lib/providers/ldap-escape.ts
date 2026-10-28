/**
 * Escapes a string for use in an LDAP filter according to RFC 4515.
 * Replaces '*', '(', ')', '\', and NUL with their hex equivalents.
 */
export function escapeLdapFilter(input: string): string {
  let escaped = '';
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    switch (char) {
      case '*':
        escaped += '\\2a';
        break;
      case '(':
        escaped += '\\28';
        break;
      case ')':
        escaped += '\\29';
        break;
      case '\\':
        escaped += '\\5c';
        break;
      case '\0':
        escaped += '\\00';
        break;
      default:
        escaped += char;
    }
  }
  return escaped;
}
