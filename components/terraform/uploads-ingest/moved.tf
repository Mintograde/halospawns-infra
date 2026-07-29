moved {
  from = aws_cloudfront_origin_access_control.uploads_oac
  to   = aws_cloudfront_origin_access_control.uploads_oac[0]
}

moved {
  from = aws_cloudfront_public_key.main
  to   = aws_cloudfront_public_key.main[0]
}

moved {
  from = aws_cloudfront_key_group.main
  to   = aws_cloudfront_key_group.main[0]
}

moved {
  from = aws_acm_certificate.cert
  to   = aws_acm_certificate.cert[0]
}

moved {
  from = aws_cloudfront_distribution.s3_distribution
  to   = aws_cloudfront_distribution.s3_distribution[0]
}
