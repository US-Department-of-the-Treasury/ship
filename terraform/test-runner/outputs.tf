output "public_ip" {
  description = "Elastic IP address of the test runner"
  value       = aws_eip.test_runner.public_ip
}

output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.test_runner.id
}

output "ssh_config" {
  description = "Add this to ~/.ssh/config"
  value       = <<-EOT

    # Ship E2E Test Runner
    Host test-runner
      HostName ${aws_eip.test_runner.public_ip}
      User ubuntu
      IdentityFile ~/.ssh/${var.key_name}.pem
      StrictHostKeyChecking no
      ServerAliveInterval 60

  EOT
}

output "ssh_command" {
  description = "SSH command to connect"
  value       = "ssh -i ~/.ssh/${var.key_name}.pem ubuntu@${aws_eip.test_runner.public_ip}"
}
