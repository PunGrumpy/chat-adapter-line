# Contributing to chat-adapter-line

Thank you for your interest in contributing! This project is an open-source adapter for the LINE Messaging API using the Chat SDK. Contributions are welcome! Whether you want to improve the documentation, add features, or fix bugs, here's how you can get involved.

## Source Code

The source code is hosted on GitHub at [PunGrumpy/chat-adapter-line](https://github.com/PunGrumpy/chat-adapter-line).

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork: `git clone https://github.com/<your-username>/chat-adapter-line.git`
3. Install dependencies: `bun install`
4. Create a new branch for your feature or bug fix: `git checkout -b feature/your-feature-name`
5. Make your changes
6. Run tests: `bun run test`
7. Ensure code quality:
   - Typecheck: `bun run typecheck`
   - Lint: `bun run lint`
   - Format: `bun run format`
8. Build the package: `bun run build`
9. Commit your changes with clear, descriptive commit messages
10. Push to your fork
11. Submit a Pull Request

## Changesets

We use [Changesets](https://github.com/changesets/changesets) to manage versions and changelogs. When you make changes that should be released, you need to create a changeset:

1. Run `bun run changeset` in the root directory
2. Choose the appropriate version bump:
   - `patch` - Bug fixes and minor changes
   - `minor` - New features that don't break existing functionality
   - `major` - Breaking changes
3. Write a clear description of your changes (this will appear in the changelog)
4. Commit the generated changeset file in `.changeset/` with your changes

**When to create a changeset:**

- Bug fixes
- New features
- Breaking changes
- Performance improvements
- Documentation updates that affect usage

**When NOT to create a changeset:**

- Internal refactoring with no user-facing changes
- Test updates
- Build configuration changes
- README or contributing guide updates

## Pull Request Guidelines

- Ensure your PR addresses a specific issue or adds value to the project
- Include a clear description of the changes and rationale
- Keep changes focused and atomic
- Follow existing code style and conventions
- Include tests if applicable
- **Add a changeset if your changes affect the published package**
- Ensure all checks pass: `bun run test`, `bun run lint`, and `bun run typecheck`
- Write clear commit messages

## Development Commands

From the root directory, you can run:

- `bun run dev` - Build package in watch mode
- `bun run build` - Build package for production
- `bun run test` - Run tests using Vite Plus Test
- `bun run lint` - Run Ultracite linter (`bun x ultracite check`)
- `bun run format` - Auto-fix linting/formatting issues (`bun x ultracite fix`)
- `bun run typecheck` - Run TypeScript type checking (`tsc --noEmit`)
- `bun run benchmark` - Run the benchmarks in `bench/`

Use `bun run`, not the bare `bun test` or `bun build`. Those run Bun's own test runner and bundler instead of the project's scripts, and they fail.

## Reporting Issues and Discussions

### Bugs and Issues

Use the GitHub [issue tracker](https://github.com/PunGrumpy/chat-adapter-line/issues) to report bugs:

- Check if the issue already exists before creating a new one
- Provide a clear description with examples
- Include steps to reproduce if applicable

### Feature Requests and Discussions

For potential changes, feature requests, or general discussions, please open an [issue](https://github.com/PunGrumpy/chat-adapter-line/issues).

## Code of Conduct

Please note that this project follows a Code of Conduct. By participating, you are expected to uphold this code.

Thank you for contributing!
