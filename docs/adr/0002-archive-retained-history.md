# Archive retained event and Match history

Move live `events` and `matched_events` older than the configured retention horizon into separate MongoDB archive collections in bounded transactions. Keep archived details indefinitely so API A and ranking rebuilds remain complete; API B uses its durable count projection, so moving Match documents does not change totals. This shrinks the live collections while retaining the same total MongoDB data, which means archives still need backup and capacity planning.
