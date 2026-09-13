import { IsEmail, MinLength } from 'class-validator';

export class ClaimDto {
  @IsEmail()
  email!: string;

  @MinLength(8)
  password!: string;
}
