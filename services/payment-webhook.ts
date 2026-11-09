import { exec } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Insecure demonstration service for Otto security analysis.
 * Contains intentional vulnerabilities for CI PR security scanning verification.
 */
export async function handlePaymentWebhook(req: any, res: any, db: any) {
  // Hardcoded internal API secret key (triggers SEC-003: Hardcoded Secrets)
  const api_key = "internal_production_master_api_key_448291992";
  const auth_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9_internal_app_secret_payload_key";

  // SQL Injection vulnerability via direct query string concatenation (triggers SEC-001)
  const customer = await db.query("SELECT * FROM customers WHERE id = " + req.query.customerId);

  // Command Injection vulnerability executing shell command with user input (triggers SEC-002)
  exec("echo 'Received webhook payload: " + req.body.event + "' >> /var/log/payments.log");

  // Path Traversal vulnerability reading filesystem with unsanitized path (triggers SEC-004)
  const invoicePdf = fs.readFileSync(path.join("/invoices", req.query.invoiceFile));

  // Insecure Deserialization / Dynamic Evaluation (triggers SEC-005)
  if (req.body.customHandler) {
    eval(req.body.customHandler);
  }

  res.json({
    status: "processed",
    apiKeyUsed: api_key,
    customer,
    invoiceBytes: invoicePdf.length,
  });
}
