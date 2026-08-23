ALTER TABLE "manual_creation_requests"
  ADD CONSTRAINT "manual_creation_requests_operation_check"
    CHECK ("operation" IN (
      'content_plan_create',
      'content_post_create',
      'content_item_create',
      'content_variant_create',
      'publication_create',
      'conversation_create'
    )),
  ADD CONSTRAINT "manual_creation_requests_request_id_check"
    CHECK ("request_id" ~ '^[A-Za-z0-9_-]{10,100}$'),
  ADD CONSTRAINT "manual_creation_requests_request_hash_check"
    CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "manual_creation_requests_response_body_check"
    CHECK (jsonb_typeof("response_body") = 'object'),
  ADD CONSTRAINT "manual_creation_requests_status_code_check"
    CHECK ("status_code" BETWEEN 100 AND 599);
