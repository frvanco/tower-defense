import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

const PSEUDO_PATTERN = /^[\p{L}\p{N}_\- ]+$/u;

export class GuestDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 20)
  @Matches(PSEUDO_PATTERN, {
    message: 'pseudo must contain only letters, digits, dashes, underscores and spaces',
  })
  pseudo!: string;
}
