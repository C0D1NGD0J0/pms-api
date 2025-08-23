import {
  UserFilterQuerySchema,
  UserRoleParamSchema,
  UserUidParamSchema,
  UserIdParamSchema,
} from './schemas';

export class UserValidations {
  static userUidParam = UserUidParamSchema;
  static userIdParam = UserIdParamSchema;
  static userFilterQuery = UserFilterQuerySchema;
  static userRoleParam = UserRoleParamSchema;
}
